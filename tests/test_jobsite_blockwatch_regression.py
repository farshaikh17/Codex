import logging
import unittest
from engine.jobsite_discovery import BlockWatch, blocked_note


class BlockWatchRegression(unittest.TestCase):
    def test_captures_actual_jobspy_logger_names(self):
        watch = BlockWatch()
        for name, message in [('jobspy.linkedin', 'response status code 429'),
                              ('jobspy.bayt', 'response status code 403'),
                              ('JobSpy.indeed', 'rate limited')]:
            watch.emit(logging.LogRecord(name, logging.ERROR, '', 0, message, (), None))
        messages = watch.take()
        self.assertEqual(len(messages), 3)
        self.assertIn('429', blocked_note([], messages))

    def test_ignores_unrelated_loggers_and_nonblocking_messages(self):
        watch = BlockWatch()
        for name, message in [('other', '429 blocked'), ('jobspy.google', 'no job data returned'),
                              ('jobspyimposter', '403')]:
            watch.emit(logging.LogRecord(name, logging.ERROR, '', 0, message, (), None))
        self.assertEqual(watch.take(), [])

    def test_partial_results_are_not_counted_as_blocked(self):
        self.assertIsNone(blocked_note([{'title': 'Example'}], ['429']))


if __name__ == '__main__':
    unittest.main()
