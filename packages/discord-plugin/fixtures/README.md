# Receipt extraction regression fixtures

Real (or receipt-creator-generated) receipt images with known-good extractions.
When Penny's duty block or model changes, re-run her against these and diff.

Layout:
  fixtures/images/<name>.jpg          — the receipt photo
  fixtures/expected/<name>.json       — the expected ReceiptExtraction (src/types.ts)

Populate during Phase 0/1 from real family receipts (min: 1 clean thermal receipt,
1 crumpled/photographed-at-angle, 1 handwritten market receipt, 1 multi-page invoice
PDF, 1 cash-marked receipt). Keep totals/vendors REAL — that is the point.
No automation yet (YAGNI until the set stabilizes); compare by hand or with jq diff.
