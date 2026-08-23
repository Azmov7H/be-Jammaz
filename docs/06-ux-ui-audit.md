# UX/UI Audit — Jammaz System

## Scope Note
This repository contains **only the backend** (Node.js/Express/MongoDB) with no frontend/UI code. The UX/UI audit is therefore limited to:
- API response format consistency (which affects frontend UX)
- Backend-generated data that feeds into the frontend
- Identification of what the frontend should address

## API Response Format Consistency

### Current Response Format (via `routeHandler`)

```json
{
    "success": true,
    "data": ...,
    "message": null,
    "timestamp": "2024-..."
}
```

#### Error Format
```json
{
    "success": false,
    "message": "خطأ في التحقق من البيانات",
    "data": null,
    "timestamp": "2024-..."
}
```

### Inconsistencies

1. **`authController.login()`** returns `result.user` directly instead of the standard format — frontend receiving login response gets `{ id, name, email, role, picture }` without `success`, `timestamp`, or `message` fields. Other endpoints consistently use the standard format.

2. **`ApiResponse.error()`** returns `{ response, statusCode }` tuple — not directly used as Express response. The `routeHandler` format is what actually reaches the frontend.

3. **Some controllers return raw Mongoose documents** without going through `routeHandler` or `ApiResponse` — inconsistent shape.

## Backend-Generated Data Quality Affecting Frontend UX

### 1. Invoice Number Format
- Backend generates: `INV-{Date.now()}`
- Frontend expects predictable formatting for display in lists, tables, modals
- **Impact**: Random-looking numbers don't provide meaningful information to users; harder to reference invoices

### 2. Customer Balance Display
- `Customer.balance` can be positive (owed TO company) or negative (owed BY company)
- No frontend indicator of sign/meaning; relies on backend to convey
- **Impact**: Frontend may display balance without context; users may not understand if they owe money or are owed money

### 3. Stock Levels
- `Product.shopQty`, `Product.warehouseQty`, `Product.stockQty` (auto-computed)
- Frontend inventory displays depend on accurate backend data
- **Impact**: If stock calculations are incorrect (see BL-003), frontend shows wrong availability

### 4. Payment Types Display
- `paymentType`: 'cash' | 'credit' | 'bank' | 'wallet' | 'check'
- `paymentStatus`: 'paid' | 'partial' | 'pending'
- Frontend needs to display human-readable labels for these
- **Backend currently lacks** a centralized enum-to-label mapping (beyond what Zod provides)

### 5. Notification Messages
- Arabic messages generated in `notificationService.js` sync functions
- Examples: "نقص في المحل: ${product.name}", "فاتورة #${inv.number} متأخرة بمبلغ ${balance}"
- **Backend generates full Arabic messages** — frontend just displays them; no i18n separation
- **Impact**: Frontend cannot customize or truncate these messages; language is hardcoded in backend

### 6. Dashboard KPI Values
- `DashboardService.getKPIs()` returns: todaySales, todayProfit, cashBalance, totalStockValue, etc.
- Format: numbers (some with Arabic formatting implied, some raw)
- Frontend dashboard components render these values
- **Impact**: Any calculation inconsistencies (see Business Logic Audit) directly affect what frontend displays

## Recommended UX/UI Improvements (Backend-Focused)

### 1. Standardize API Response Format
- Make `authController.login()` return the same format as `routeHandler`
- Ensure all controllers go through `routeHandler` or consistently use `ApiResponse`
- Add `message` field to all success responses (currently some have `message: null`, others have actual messages)

### 2. Add Human-Readable Enum Mappings
Create backend utilities for converting enums to display labels:

```javascript
// Example: payment type labels
PAYMENT_TYPE_LABELS = {
    cash: 'نقدي',
    credit: 'آجل', 
    bank: 'تحويل بنكي',
    wallet: 'محفظة',
    check: 'شيك'
};

PAYMENT_STATUS_LABELS = {
    paid: 'مدفوع',
    partial: 'جزئي',
    pending: ' Pending'
};
```

### 3. Invoice Number Best Practice
- Use a more meaningful format: `INV-{YYYY}{MM}{SS}-{sequence}` or use the receipt number sequence
- Ensure uniqueness without relying on random suffixes

### 4. Customer Balance Context
- Add a method or field indicating balance direction: `balanceDirection: 'owed_by_customer' | 'owed_by_company'`
- Or: `balanceStatus: 'positive' | 'negative' | 'zero'`

### 5. Payment Method Labels (Arabic)
Add to a central constants file:
```javascript
PAYMENT_METHOD_ARABIC = {
    cash: 'نقدي',
    credit: 'آجل',
    bank: 'تحويل بنكي',
    wallet: 'محفظة',
    check: 'شيك'
};
```

### 6. Notification Message Structure
Instead of generating full Arabic strings in the backend, emit structured data:
```javascript
{ type: 'stock_low', severity: 'warning', productId, suggestedAction }
```
And let the frontend generate the Arabic message based on locale.

## Frontend Integration Checklist (For Future Frontend Work)

| Item | Backend State | Frontend Action Needed |
|------|--------------|----------------------|
| API response format | Inconsistent (auth returns user directly) | Standardize all responses |
| Payment type labels | None centralized | Add mapping; frontend use it |
| Customer balance | Raw number, no context | Add direction indicator; frontend display |
| Stock data | Accurate but complex calculations | Validate calculations; frontend display |
| Invoice references | `INV-{Date.now()}` | Consider sequential numbering |
| Notification messages | Full Arabic strings from backend | Emit structured events; frontend i18n |
| Dashboard KPI data | Depends on correct business logic | Validate logic first; then consume |