import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys

source = Path(__file__).resolve().parents[1] / "deploy/managed/render.py"
spec = importlib.util.spec_from_file_location("managed_render", source)
render = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render)
sys.path.insert(0, str(source.parent))
from app_ingress import update  # noqa: E402


class ManagedDeploymentTests(unittest.TestCase):
    def fixture(self):
        return {"runtime": "11111111-1111-4111-8111-111111111111", "workspace": "22222222-2222-4222-8222-222222222222",
            "instance": "33333333-3333-4333-8333-333333333333", "hostname": "fixture.alshival.cloud", "release": "a" * 40,
            "images": {name: f"fixture/{name}@sha256:" + "b" * 64 for name in ("postgres", "control-plane", "workspace")},
            "storage_root": "/mnt/fixture/slot0", "slot": 0, "port": 43000, "memory_mb": 4096, "cpu": 2,
            "subnet": "172.29.1.0/28", "portal_secret": "p" * 43, "database_password": "d" * 43,
            "master_key": "a" * 64, "control_token": "c" * 43, "mcp_token": "m" * 43}

    def test_no_platform_secrets_in_workspace_and_all_state_in_slot(self):
        cfg = self.fixture()
        compose, descriptor, ingress = render.build(cfg, Path("/etc/neura/fixture"))
        workspace = compose["services"]["workspace"]
        self.assertNotIn(cfg["portal_secret"], str(workspace))
        self.assertNotIn(cfg["database_password"], str(workspace))
        self.assertNotIn(cfg["master_key"], str(workspace))
        self.assertEqual(workspace["environment"]["NEURAL_LABS_APP_DOMAIN"], cfg["hostname"])
        for service in compose["services"].values():
            self.assertEqual(service["restart"], "no")
            self.assertNotIn("privileged", service)
            self.assertNotIn("network_mode", service)
            for port in service.get("ports", []): self.assertTrue(port.startswith("127.0.0.1:"))
            for volume in service.get("volumes", []): self.assertTrue(volume.startswith(cfg["storage_root"] + "/"))
        self.assertNotIn("database", workspace["networks"])
        self.assertTrue(compose["networks"]["database"]["internal"])
        self.assertEqual(descriptor["release"], cfg["release"])
        self.assertIn("listen 127.0.0.1:43000;", ingress)
        self.assertNotIn("listen 443", ingress)
        self.assertNotIn("listen 80", ingress)
        self.assertIn("X-Forwarded-Proto https", ingress)
        self.assertIn("auth_request /_workspace_auth", ingress)
        self.assertIn("location ^~ /__alshival_app/", ingress)
        self.assertIn("allow 127.0.0.1; deny all;", ingress)
        for header in ("user", "email", "role", "redirect"):
            self.assertIn("$upstream_http_x_neural_labs_" + header, ingress)

    def test_native_runtime_has_no_gateway_or_legacy_mounts(self):
        compose, descriptor, ingress = render.build(self.fixture(), Path("/etc/neura/fixture"))
        workspace = compose["services"]["workspace"]
        self.assertEqual(descriptor["runtime_kind"], "native")
        self.assertEqual(workspace["ports"], ["127.0.0.1:43003:18790"])
        self.assertEqual(workspace["cap_add"], [])
        self.assertTrue(workspace["read_only"])
        self.assertEqual(workspace["user"], "1000:1000")
        self.assertIn("apparmor=neural-labs-native-v1", workspace["security_opt"])
        self.assertNotIn("openclaw", str(compose).lower())
        self.assertNotIn("18789", str(compose))
        self.assertNotIn("127.0.0.1:43002;", ingress)
        self.assertIn("127.0.0.1:43003;", ingress)
        self.assertTrue(workspace["volumes"][-1].endswith(":ro"))

    def test_mutable_images_and_invalid_placement_rejected(self):
        for key, value in [("hostname", "fixture.alshival.cloud; injected"), ("port", 65534), ("memory_mb", 512),
                           ("cpu", 1), ("subnet", "198.51.100.0/28"), ("storage_root", "/"), ("release", "main")]:
            cfg = self.fixture(); cfg[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): render.build(cfg, Path("/etc/neura/fixture"))
        cfg = self.fixture(); cfg["images"]["workspace"] = "fixture/workspace:latest"
        with self.assertRaises(ValueError): render.build(cfg, Path("/etc/neura/fixture"))

    def test_operator_can_register_portal_origin_without_tenant_hostname_suffix(self):
        cfg = self.fixture(); cfg["hostname"] = "portal.example.com"
        compose, descriptor, ingress = render.build(cfg, Path("/etc/neura/fixture"))
        self.assertEqual(compose["services"]["control-plane"]["environment"]["CONTROL_PLANE_PUBLIC_ORIGIN"],
                         "https://portal.example.com")
        self.assertEqual(descriptor["hostname"], cfg["hostname"])
        self.assertIn("server_name portal.example.com;", ingress)
        for hostname in ("https://portal.example.com", "localhost", "portal.example.com/path", "portal.example.com:443",
                         "-portal.example.com", "portal..example.com", "portal.example.com\n"):
            cfg["hostname"] = hostname
            with self.subTest(hostname=hostname), self.assertRaises(ValueError):
                render.build(cfg, Path("/etc/neura/fixture"))

    def test_existing_private_ingress_updates_only_reviewed_template(self):
        cfg = self.fixture()
        desired = render.ingress(cfg["hostname"], cfg["runtime"], cfg["port"])
        start = desired.index("    location ^~ /__alshival_app/ {")
        end = desired.index("    location = /healthz {", start)
        previous = desired[:start] + desired[end:] + "\n"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            descriptor = root / "instance" / "descriptor.json"
            descriptor.parent.mkdir()
            descriptor.write_text(__import__("json").dumps(cfg))
            source_conf = descriptor.parent / "ingress.conf"
            source_conf.write_text(previous)
            target = root / "conf.d" / ("neura-labs-" + cfg["runtime"] + ".conf")
            target.parent.mkdir()
            target.write_text(previous)
            with patch("app_ingress.os.geteuid", return_value=0), patch("app_ingress.owned_file"), \
                 patch("app_ingress.subprocess.run") as commands:
                self.assertIn("ready", update(descriptor, etc=root))
                self.assertEqual(target.read_text(), previous)
                self.assertIn("installed", update(descriptor, apply=True, etc=root))
                self.assertEqual(target.read_text(), desired)
                self.assertEqual(source_conf.read_text(), desired)
                self.assertEqual(commands.call_count, 2)
                target.write_text(previous + "# unreviewed\n")
                with self.assertRaises(ValueError): update(descriptor, apply=True, etc=root)


if __name__ == "__main__": unittest.main()
