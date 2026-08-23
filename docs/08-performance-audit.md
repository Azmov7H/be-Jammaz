# Performance Audit — Jammaz System

## Frontend Performance
*(Not applicable — this repository contains only the backend)*

## Backend Performance

### Database Query Performance

#### 1. Dashboard Aggregation Pipelines (`dashboardService.js:getKPIs()`)

**Pipelines executed in parallel (8 aggregations)**:
- Invoice aggregation for today/month sales (2 pipelines)
- Treasury transaction aggregations for today/month expenses (2 pipelines)
- Customer + Supplier balance aggregation (2 pipelines via `Promise.all`)
- Product inventory aggregation (1 pipeline)
- Purchase order count (1 simple query)
- Recent invoices fetch (1 simple query)

**Performance concerns**:
- **Customer + Supplier balance aggregation** uses `{$match: { balance: { $ne: 0 } }}` which forces a full collection scan if no index efficiently covers it. Customer schema has `index({ balance: 1 })` and Supplier likely has similar — but `balance` changes frequently and may not have good cache locality.
- **Product inventory aggregation** uses `$multiply` and `$cond` inside `$group` — computationally expensive for large product catalogs.
- **No query limits** on some aggregations — if the system has thousands of invoices/customers, these pipelines could be slow.

**Impact**: Dashboard load time could be 2-5+ seconds with large datasets.

#### 2. Daily Sales Aggregation (`dailyServiceService.js:getSalesSummary()`)

- Fetches all `DailySales` records in a date range with no limit other than the range size
- One record per day — typically 30-365 records per query
- Performance is acceptable for typical ranges

#### 3. Debt Aging Report (`debtService.js:getAgingData()`)

- Fetches all debts with `status: { $in: ['active', 'overdue'] }` — could be a large collection
- Then iterates in JavaScript to calculate tiers
- No pagination or limit for the aging overview

**Impact**: May be slow if there are thousands of active/overdue debts.

#### 4. Customer Debtors With Aggregation (`debtService.js:getDebtorsWithBalance()`)

- Uses full aggregation pipeline with `$lookup` to customers/suppliers
- Has search filter with `$regex` — cannot use index efficiently for leading wildcard
- Pagination supported but the lookup + unwind is expensive

**Impact**: Slow with large customer/m supplier bases and search queries.

### N+1 Query Risks

1. **Notification population chains**: `Notification.getUserNotifications()` populates `recipientId`, `targetRole`, then each notification may have populated fields. Multiple calls could trigger multiple queries.

2. **Treasury transaction populate depth**: `TreasuryService.getTransactions()` populates `referenceId` which itself populates `customer`, `supplier`, `debtorId` — deep population with many documents could be slow.

3. **Physical inventory populate**: `PhysicalInventoryService.getCountById()` populates `items.productId`, `createdBy`, `approvedBy` — three population calls per query.

### Missing Indexes (Potential)

| Table/Collection | Common Query Pattern | Index Status | Recommendation |
|-----------------|---------------------|--------------|----------------|
| **Invoice** | `findByCustomer`, `findByPaymentStatus+Date`, `findByDate` | ✅ Has indexes: `date`, `customer`, `paymentStatus+date`, `customer+date` | Adequate |
| **Customer** | `findByPhone`, `findByName+Balance`, text search | ✅ Has: `phone (unique)`, `name`, `balance`, text index on `name+phone` | Adequate |
| **Product** | `findByCategory+Active`, `findByCode`, `findByStockQty` | ✅ Has: `name+code+index`, `category+isActive`, `stockQty`, `warehouseQty+shopQty` | Adequate |
| **Debt** | `findByDebtorId+Status`, `findByDueDate+Status` | ✅ Has: `debtorType+debtorId+status`, `dueDate+status` | Adequate |
| **TreasuryTransaction** | `findByReferenceType+ReferenceId`, `findByDate+Type` | ✅ Has: `type+date`, `type+referenceType+date` | Adequate |
| **InvoiceSettings** | `findOne({isActive: true})` | ✅ `isActive` is unique | Adequate |

### Memory & CPU

1. **Large aggregate pipelines** in dashboard service — each pipeline processes all matching documents in memory before grouping. With thousands of records, this could cause GC pressure.

2. **DailySales topProducts slice**: `dailySales.topProducts.slice(0, 10)` keeps only top 10 — good for memory, but the sort `dailySales.topProducts.sort((a, b) => b.revenue - a.revenue)` is O(n log n) on all items per invoice.

3. **Treasury transaction aggregation** in `getSummary()` — reduces all transactions in a date range to totals. With months/years of data, this could be substantial.

### Caching

1. **`lib/cache.js`** and **`lib/cache-config.js`** exist but appear to be **designed for frontend React Query**, not backend caching. No backend caching layer detected.

2. **No HTTP caching headers** beyond helmet basic headers. No `Cache-Control`, `ETag`, or `Last-Modified` responses.

3. **Database-level caching** — MongoDB has its own WiredTiger cache, but no application-level caching observed.

### Connection Pooling

1. **Mongoose default settings** — uses default connection pool size (5). No explicit pooling configuration observed.

2. **`dbConnect()` sets `bufferCommands: false`** — prevents buffering but means failed queries return immediate errors rather than waiting for reconnection.

### Query Performance Recommendations

1. **Add indexes for frequent report queries**:
   - `Invoice: { customer: 1, paymentStatus: 1, date: -1 }` (already exists)
   - `Debt: { debtorType: 1, status: 1, remainingAmount: 1 }` (for aging queries)
   - `TreasuryTransaction: { date: -1, type: 1 }` (already has compound indexes)

2. **Add query limits** to aging/debtor queries to prevent accidental full-collection scans.

3. **Implement backend caching** for frequently accessed read-only data:
   - Invoice settings (already singleton-like)
   - Product metadata (brands, categories)
   - Dashboard KPIs (with appropriate TTL)

4. **Consider aggregation optimization**:
   - Add `$sample` for preview data in dashboards
   - Use `lean()` where full Mongoose document features aren't needed (already used in many places)
   - Add `maxTimeMS` to long-running aggregations

5. **Connection pool tuning** for production scale:
   ```javascript
   mongoose.createConnection(uri, {
     poolSize: 10,
     bufferCommands: false,
     serverSelectionTimeoutMS: 5000
   });
   ```

## Network Performance

### API Response Sizes

1. **Standard success response** (~200 bytes overhead + data)
2. **Invoice list responses** include populated customer, createdBy, and items with product details — can be several KB per invoice
3. **Dashboard unified data** (`getUnifiedData()`) combines KPIs, stats, and strategy — potentially large single response

### Rate Limiting

- **100 requests per 15 minutes per IP** on `/api/` prefix
- May be too restrictive for internal/partner integrations
- No per-route rate limiting (e.g., auth routes may need lower limits)

## Summary of Performance Issues

| Category | Issue | Impact | Effort |
|----------|-------|--------|--------|
| Database | Dashboard aggregations with large datasets | 2-5+ second load times | MEDIUM |
| Database | Debt aging iteration in JS (no cursor optimization) | Slow with thousands of debts | LOW |
| Database | Missing indexes for specific report patterns | Variable, potentially slow | LOW |
| Caching | No backend HTTP or application caching | Every request hits database | MEDIUM |
| Code | Daily sales topProducts sort on all items per day | Minor optimization | LOW |
| Aggregation | Complex pipelines without $maxTimeMS | Risk of long-running queries | MEDIUM |