import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import dbConnect from '../lib/db.js';
import { withTransaction } from '../utils/dbUtils.js';
import { NotFoundError, ConflictError, BadRequestError } from '../lib/errors.js';
import { LogService } from './logService.js';

/**
 * Customer ↔ Supplier unification (Sprint 7 — FIN-SVC-006, "Option B").
 *
 * One underlying entity can act as both a Customer and a Supplier. Linking a
 * Customer to a Supplier (or vice-versa) records the relationship on both
 * records so the system can show a combined net position and avoid creating
 * a duplicate record.
 *
 * Balance conventions (kept consistent with the legacy domain):
 *   - Customer.balance  = what the CUSTOMER owes US  (debit, positive)
 *   - Supplier.balance  = what WE owe the SUPPLIER   (credit, positive)
 *   - Net position (customer's perspective)
 *       = customer.balance - supplier.balance
 *     positive  → the entity owes us
 *     negative  → we owe the entity
 */

const toId = (v) => (typeof v === 'string' ? v : v?.toString?.());

async function linkWithinTransaction(sourceType, sourceId, targetId) {
    // A Mongo _id is globally unique across collections, so equal ids can only
    // mean self-link (E3) — must be rejected before resolving by type, since
    // the same id cannot be both a Customer and a Supplier doc.
    if (toId(sourceId) === toId(targetId)) {
        throw new BadRequestError('لا يمكن ربط الكيان بنفسه');
    }

    let [source, target] = sourceType === 'Customer'
        ? [await Customer.findById(sourceId), await Supplier.findById(targetId)]
        : [await Supplier.findById(sourceId), await Customer.findById(targetId)];

    if (!source) throw new NotFoundError('السجل المصدر غير موجود');
    if (!target) throw new NotFoundError('السجل الهدف غير موجود');

    const srcId = source._id.toString();
    const tgtId = target._id.toString();
    if (srcId === tgtId) {
        throw new BadRequestError('لا يمكن ربط الكيان بنفسه');
    }

    // Determine current link state on each side.
    // sourceType 'Customer' → source.linkedSupplier, target.linkedCustomer
    // sourceType 'Supplier' → source.linkedCustomer, target.linkedSupplier
    const sourceCurrent = sourceType === 'Customer' ? source.linkedSupplier : source.linkedCustomer;
    const targetCurrent = sourceType === 'Customer' ? target.linkedCustomer : target.linkedSupplier;

    // Idempotency: already linked to each other → no-op success.
    if (sourceCurrent && sourceCurrent.toString() === tgtId && targetCurrent && targetCurrent.toString() === srcId) {
        return { linked: true, alreadyLinked: true, source, target };
    }

    // Source already linked to a DIFFERENT entity → conflict (E4).
    if (sourceCurrent && sourceCurrent.toString() !== tgtId) {
        throw new ConflictError('السجل المصدر مرتبط بالفعل بكيان آخر');
    }
    // Target already linked to a DIFFERENT entity → conflict (E4).
    if (targetCurrent && targetCurrent.toString() !== srcId) {
        throw new ConflictError('السجل الهدف مرتبط بالفعل بكيان آخر');
    }

    // Establish the mutual link.
    if (sourceType === 'Customer') {
        source.isSupplier = true;
        source.linkedSupplier = target._id;
        target.isCustomer = true;
        target.linkedCustomer = source._id;
    } else {
        source.isCustomer = true;
        source.linkedCustomer = target._id;
        target.isSupplier = true;
        target.linkedSupplier = source._id;
    }

    const [savedSource, savedTarget] = await Promise.all([source.save(), target.save()]);
    return { linked: true, alreadyLinked: false, source: savedSource, target: savedTarget };
}

export const PartyService = {
    /**
     * Link a Customer ↔ Supplier (FIN-RTE-001).
     * Idempotent: linking the same pair again is a no-op success, not an error.
     * E3: self-link → 400. E4: link to an already-linked (different) entity → 409.
     * @param {'Customer'|'Supplier'} sourceType Which record initiated the link.
     * @param {string} sourceId
     * @param {string} targetId The other-type record to link.
     * @param {string} [actor] Authenticated user id (audit, SEC-AUD-001).
     */
    async link(sourceType, sourceId, targetId, actor) {
        await dbConnect();
        if (sourceType !== 'Customer' && sourceType !== 'Supplier') {
            throw new BadRequestError('نوع المصدر غير صالح');
        }
        const result = await withTransaction(async () => linkWithinTransaction(sourceType, sourceId, targetId));
        if (actor) {
            // SEC-AUD-001: audit party link (non-blocking; logAction catches errors).
            await LogService.logAction({
                userId: actor,
                action: 'PARTY_LINK',
                entity: 'Party',
                entityId: result.target?._id?.toString?.() || targetId,
                diff: { sourceType, sourceId, targetId, alreadyLinked: !!result.alreadyLinked },
                note: `ربط ${sourceType} إلى ${result.target?._id?.toString?.() || targetId}`,
            });
        }
        return result;
    },

    /**
     * Remove the Customer ↔ Supplier link (FIN-RTE-001).
     * @param {'Customer'|'Supplier'} sourceType
     * @param {string} sourceId
     * @param {string} [actor] Authenticated user id (audit, SEC-AUD-001).
     */
    async unlink(sourceType, sourceId, actor) {
        await dbConnect();
        if (sourceType !== 'Customer' && sourceType !== 'Supplier') {
            throw new BadRequestError('نوع المصدر غير صالح');
        }
        const result = await withTransaction(async () => {
            const source = sourceType === 'Customer'
                ? await Customer.findById(sourceId)
                : await Supplier.findById(sourceId);
            if (!source) throw new NotFoundError('السجل المصدر غير موجود');

            const other = sourceType === 'Customer' ? source.linkedSupplier : source.linkedCustomer;
            if (!other) return { unlinked: true, alreadyUnlinked: true };

            const target = sourceType === 'Customer'
                ? await Supplier.findById(other)
                : await Customer.findById(other);

            if (sourceType === 'Customer') {
                source.isSupplier = false;
                source.linkedSupplier = undefined;
                if (target) {
                    target.isCustomer = false;
                    target.linkedCustomer = undefined;
                }
            } else {
                source.isCustomer = false;
                source.linkedCustomer = undefined;
                if (target) {
                    target.isSupplier = false;
                    target.linkedSupplier = undefined;
                }
            }

            await source.save();
            if (target) await target.save();
            return { unlinked: true, alreadyUnlinked: false, targetId: other };
        });
        if (actor) {
            // SEC-AUD-001: audit party unlink (non-blocking).
            await LogService.logAction({
                userId: actor,
                action: 'PARTY_UNLINK',
                entity: 'Party',
                entityId: sourceId,
                diff: { sourceType, sourceId, targetId: result.targetId },
                note: `فك ربط ${sourceType} من كيانه المرتبط`,
            });
        }
        return result;
    },

    /**
     * Combined net position for an entity that is (or may be) both a customer
     * and a supplier (FIN-UI-014).
     * net = customer.balance - supplier.balance
     * @param {'Customer'|'Supplier'} type
     * @param {string} id
     */
    async getNetPosition(type, id) {
        await dbConnect();
        let customer, supplier;
        if (type === 'Customer') {
            customer = await Customer.findById(id).lean();
            if (!customer) throw new NotFoundError('العميل غير موجود');
            supplier = customer.linkedSupplier
                ? await Supplier.findById(customer.linkedSupplier).select('balance name').lean()
                : null;
        } else if (type === 'Supplier') {
            supplier = await Supplier.findById(id).lean();
            if (!supplier) throw new NotFoundError('المورد غير موجود');
            customer = supplier.linkedCustomer
                ? await Customer.findById(supplier.linkedCustomer).select('balance creditBalance name').lean()
                : null;
        } else {
            throw new BadRequestError('نوع الكيان غير صالح');
        }

        const customerBalance = customer?.balance ?? 0;
        const supplierBalance = supplier?.balance ?? 0;
        const net = customerBalance - supplierBalance;

        return {
            id,
            type,
            linked: Boolean(customer?.linkedSupplier || supplier?.linkedCustomer),
            customer: customer
                ? { id: customer._id, name: customer.name, balance: customerBalance }
                : null,
            supplier: supplier
                ? { id: supplier._id, name: supplier.name, balance: supplierBalance }
                : null,
            netPosition: net,
            // positive → they owe us; negative → we owe them
            side: net > 0 ? 'entityOwesUs' : net < 0 ? 'weOweEntity' : 'balanced'
        };
    },

    /**
     * Read-only duplicate detection across Customers and Suppliers
     * (FIN-UI-015). Returns candidate groups matched by normalized name
     * and/or phone/taxNumber. Never mutates data — a human reviewer
     * confirms any link via `link()`.
     */
    async detectDuplicates() {
        await dbConnect();
        const [customers, suppliers] = await Promise.all([
            Customer.find().select('name phone taxNumber balance isSupplier linkedSupplier').lean(),
            Supplier.find().select('name phone taxNumber balance isCustomer linkedCustomer').lean()
        ]);

        const norm = (s = '') => String(s).trim().replace(/\s+/g, ' ').toLowerCase();
        const map = new Map(); // key → group
        const groups = [];

        const consider = (kind, doc) => {
            const keys = [norm(doc.name), norm(doc.phone), norm(doc.taxNumber)].filter(Boolean);
            for (const k of keys) {
                if (!map.has(k)) {
                    map.set(k, { key: k, members: [], kind });
                    groups.push(map.get(k));
                }
                const group = map.get(k);
                if (!group.members.some((m) => m.kind === kind && toId(m.id) === toId(doc._id))) {
                    group.members.push({
                        kind,
                        id: doc._id,
                        name: doc.name,
                        phone: doc.phone ?? '',
                        taxNumber: doc.taxNumber ?? '',
                        balance: doc.balance ?? 0,
                        linked: Boolean(doc.linkedSupplier || doc.linkedCustomer)
                    });
                }
            }
        };

        for (const c of customers) consider('Customer', c);
        for (const s of suppliers) consider('Supplier', s);

        // Only surface groups with more than one distinct record.
        const candidates = groups
            .filter((g) => g.members.length > 1)
            .map((g) => ({ key: g.key, members: g.members }));

        return { total: customers.length + suppliers.length, candidates };
    }
};

export default PartyService;
