# Request Flow (representative paths, audited)

## Happy path — POST /api/invoices (the one transactional flow today)

```
cookie token → authMiddleware → verify JWT → User.findById('-password') → req.user
→ routeHandler → zod createInvoiceSchema (controller copy, refine MISSING)
→ InvoiceService.create
   → withTransaction(session):
       Counter? NO → number = INV-${Date.now()}
       StockService.reduceStockForSale  ← RMW $set (DATA-001)
       TreasuryService.updateDailyCashbox ← RMW save (DATA-002)
       DebtService.createDebt if credit
       DailySalesService.updateDailySales
       AccountingEntry.createEntry (JE counter atomic)
   → commit
→ envelope {success,data:{invoice},timestamp}
```

## Error path — GET /api/financial/receipts/:id (missing receipt)

```
authMiddleware → routeHandler → inline assembly in financeRoutes.js:104-144
→ throw new Error('السند غير موجود')
→ handleError: not ending in 'not found' AND not string → status 500
Client sees 500 for a not-found (fixed by T-ARC-01 → NotFoundError 404)
```

## Auth path

```
POST /api/auth/login → global limiter bucket only
→ zod loginSchema → UserRepository.findByEmail
→ disabled? 403 distinct message (enumeration) : bcrypt.compare
→ signToken({userId,email,role}) 24h HS256
→ Set-Cookie httpOnly sameSite=lax secure(prod) path=/
→ console.log email  ← removed by T-AUTH-04
```

Post-Sprint-02 target adds: authLimiter → refresh cookie issuance → tv claim check.

## Payment path (post-fix shape)

```
POST /api/financial/payments/customer [manager+ after T-ACL-02]
→ validate(paymentSchema) [T-VAL-01]
→ FinanceService.recordCustomerPayment
→ withTransaction:
    Invoice.updateOne guarded $push/$inc      [T-DB-06]
    PaymentSchedule updates (sessional saves)
    Debt conditional findOneAndUpdate $inc     [T-DB-06]
    Customer $inc balance
    TreasuryTransaction.create + Cashbox upsert $inc
    Log entry
→ commit; fault mid-way ⇒ full rollback [T-BIZ-01 test]
```
