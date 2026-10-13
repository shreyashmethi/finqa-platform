"""
Process-wide lock for pypdfium2.

PDFium (the C library behind pypdfium2) is not thread-safe: two threads calling into it at the same
time can crash the process. Every pypdfium2 call in this codebase (page pre-filtering during
extraction, page rendering for evidence images) must hold this lock. The calls are short
(milliseconds per page), so serialising them costs little; pdfplumber, which does the heavier
layout work, is pure Python and runs in parallel.
"""

import threading

PDFIUM_LOCK = threading.Lock()
