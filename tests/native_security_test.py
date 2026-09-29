import importlib.util
from pathlib import Path
import unittest
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("snap_policy", ROOT / "deploy/security/snap_policy.py")
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)
sys.path.insert(0, str(ROOT / 'deploy/security'))
installer_spec = importlib.util.spec_from_file_location("native_security_install", ROOT / 'deploy/security/install.py')
installer = importlib.util.module_from_spec(installer_spec)
installer_spec.loader.exec_module(installer)


class NativeSecurityTest(unittest.TestCase):
    def test_daemon_extension_is_idempotent_and_scoped_to_one_new_profile(self):
        source = 'profile "snap.docker.dockerd" {\n  deny /private/** rw,\n}\n'
        result = policy.with_native_management(source)
        self.assertEqual(policy.with_native_management(result), result)
        self.assertEqual(result.replace(policy.BLOCK, ""), source)
        self.assertNotIn("peer=*", policy.BLOCK)
        self.assertNotIn("capability", policy.BLOCK)

    def test_unexpected_profiles_and_changed_rules_require_review(self):
        for source in ['profile "other" {}', 'profile "snap.docker.dockerd" {']:
            with self.assertRaises(ValueError):
                policy.with_native_management(source)
        changed = policy.with_native_management('profile "snap.docker.dockerd" {}').replace(
            "ptrace (read,trace)", "ptrace (read)"
        )
        with self.assertRaises(ValueError):
            policy.with_native_management(changed)

    def test_snap_regeneration_and_kernel_reload_reapply_without_editing_generated_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            native, snap, state = root / 'native', root / 'snap', root / 'state'
            native.write_text('profile neural-labs-native-v1 {}\n')
            original = 'profile "snap.docker.dockerd" {\n  deny /private/** rw,\n}\n'
            snap.write_text(original)
            loaded, commands = {}, []
            def command(*args):
                commands.append(args)
                if '--replace' in args:
                    name = Path(args[-1]).name
                    loaded[name] = {'mode': 'enforce', 'hash': installer.digest(Path(args[-1]).read_bytes())}
            with patch.multiple(installer, STATE=state, PROFILE=native, SNAP=snap), \
                    patch.object(installer, 'command', side_effect=command), \
                    patch.object(installer, 'loaded_profile', side_effect=lambda name: loaded.get(name)):
                installer.reconcile()
                self.assertEqual(snap.read_text(), original)
                self.assertEqual(len(commands), 4)
                self.assertEqual(len(list((state / 'originals').iterdir())), 2)
                installer.reconcile(check=True); installer.reconcile()
                self.assertEqual(len(commands), 4, 'Unchanged kernel policy must not be reloaded')
                # Snap may reload the original after the path watcher runs.
                loaded['snap.docker.dockerd']['hash'] = 'regenerated-kernel-policy'
                with self.assertRaises(RuntimeError): installer.reconcile(check=True)
                installer.reconcile(); self.assertEqual(len(commands), 6)
                regenerated = original.replace('/private/', '/changed/')
                snap.write_text(regenerated)
                installer.reconcile(); self.assertEqual(len(commands), 8)
                self.assertEqual(snap.read_text(), regenerated)
                self.assertEqual(len(list((state / 'originals').iterdir())), 3)

    def test_invalid_snap_rules_never_replace_the_daemon_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); native, snap = root / 'native', root / 'snap'
            native.write_text('profile neural-labs-native-v1 {}\n'); snap.write_text('profile "unexpected" {}')
            def command(*args):
                if '--replace' in args: self.assertEqual(Path(args[-1]).name, 'neural-labs-native-v1')
            with patch.multiple(installer, STATE=root / 'state', PROFILE=native, SNAP=snap), \
                    patch.object(installer, 'command', side_effect=command), \
                    patch.object(installer, 'loaded_profile', return_value={'mode': 'enforce', 'hash': 'fixture'}), \
                    self.assertRaises(ValueError): installer.reconcile()


if __name__ == "__main__":
    unittest.main()
