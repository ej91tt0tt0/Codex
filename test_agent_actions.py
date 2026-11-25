import unittest
from agent_actions import plan_action

class AgentActionsTest(unittest.TestCase):
    def test_allowed(self):
        self.assertEqual(plan_action("open_maps", "名古屋駅").target, "名古屋駅")
        self.assertEqual(plan_action("read_calendar").kind, "read_calendar")
        self.assertEqual(plan_action("open_app", "maps").target, "maps")
    def test_rejects_unknown(self):
        for kind, target in [("run_shell", "rm -rf /"), ("open_app", "unknown"), ("read_calendar", "secret")]:
            with self.subTest(kind=kind, target=target):
                with self.assertRaises(ValueError):
                    plan_action(kind, target)
    def test_rejects_control_characters(self):
        with self.assertRaises(ValueError):
            plan_action("open_maps", "hello\nworld")

if __name__ == "__main__":
    unittest.main()
