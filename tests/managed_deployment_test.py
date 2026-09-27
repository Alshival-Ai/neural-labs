import importlib.util
from pathlib import Path
import unittest

source = Path(__file__).resolve().parents[1] / "deploy/managed/render.py"
spec = importlib.util.spec_from_file_location("managed_render", source)
render = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render)


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
        for header in ("user", "email", "role", "redirect"):
            self.assertIn("$upstream_http_x_neural_labs_" + header, ingress)

    def test_mutable_images_and_invalid_placement_rejected(self):
        for key, value in [("hostname", "fixture.alshival.cloud; injected"), ("port", 65534), ("memory_mb", 512),
                           ("cpu", 1), ("subnet", "198.51.100.0/28"), ("storage_root", "/"), ("release", "main")]:
            cfg = self.fixture(); cfg[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): render.build(cfg, Path("/etc/neura/fixture"))
        cfg = self.fixture(); cfg["images"]["workspace"] = "fixture/workspace:latest"
        with self.assertRaises(ValueError): render.build(cfg, Path("/etc/neura/fixture"))


if __name__ == "__main__": unittest.main()
