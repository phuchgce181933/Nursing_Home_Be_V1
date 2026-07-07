const ServiceError = require('./serviceError');
const { createAuditLog } = require('../utils/auditLog');
const medicationRepo = require('../repositories/medicationRepository');
const medicationStockRepo = require('../repositories/medicationStockRepository');
const medicationDispenseRepo = require('../repositories/medicationDispenseRepository');
const medicationNoteRepo = require('../repositories/medicationNoteRepository');
const supplierRepo = require('../repositories/supplierRepository');
const Prescription = require('../models/prescription');

const parsePagination = (query) => {
	const pageNum = Math.max(1, parseInt(query.page || 1, 10));
	const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
	const skip = (pageNum - 1) * limitNum;
	return { pageNum, limitNum, skip };
};

const parseOptionalDate = (value, fieldName) => {
	if (!value) return undefined;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new ServiceError(`${fieldName} is invalid`, 400);
	}
	return date;
};

const buildTotalsMap = (rows) => {
	const map = {};
	rows.forEach((row) => {
		map[row._id.toString()] = row.total || 0;
	});
	return map;
};

const getAvailabilityMap = async (medicationIds) => {
	if (!medicationIds.length) return {};
	const [stockTotals, dispenseTotals] = await Promise.all([
		medicationStockRepo.sumQuantitiesByMedicationIds(medicationIds),
		medicationDispenseRepo.sumQuantitiesByMedicationIds(medicationIds),
	]);

	const stockMap = buildTotalsMap(stockTotals);
	const dispenseMap = buildTotalsMap(dispenseTotals);
	const availabilityMap = {};

	medicationIds.forEach((id) => {
		const key = id.toString();
		const available = (stockMap[key] || 0) - (dispenseMap[key] || 0);
		availabilityMap[key] = Math.max(0, available);
	});

	return availabilityMap;
};

const getAvailableQuantity = async (medicationId) => {
	const [stockTotals, dispenseTotals] = await Promise.all([
		medicationStockRepo.sumQuantityByMedicationId(medicationId),
		medicationDispenseRepo.sumQuantityByMedicationId(medicationId),
	]);

	const stockTotal = stockTotals[0]?.total || 0;
	const dispenseTotal = dispenseTotals[0]?.total || 0;
	return Math.max(0, stockTotal - dispenseTotal);
};

const generateMedicationCode = async () => {
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const code = `MED${Date.now().toString(36).toUpperCase()}${Math.random()
			.toString(36)
			.slice(2, 5)
			.toUpperCase()}`;
		const exists = await medicationRepo.findByCode(code);
		if (!exists) return code;
	}
	throw new ServiceError('Unable to generate medication code', 500);
};

const formatMedication = (doc, availableQuantity = 0) => {
	const medication = doc?.toObject ? doc.toObject() : doc;
	return {
		_id: medication._id,
		medicationCode: medication.medicationCode,
		name: medication.name,
		form: medication.form,
		strength: medication.strength,
		unit: medication.unit,
		manufacturer: medication.manufacturer,
		description: medication.description,
		minStockLevel: medication.minStockLevel,
		isActive: medication.isActive,
		availableQuantity,
		createdAt: medication.createdAt,
		updatedAt: medication.updatedAt,
	};
};

const formatSupplier = (doc) => {
	const supplier = doc?.toObject ? doc.toObject() : doc;
	return {
		_id: supplier._id,
		name: supplier.name,
		contactName: supplier.contactName,
		phone: supplier.phone,
		email: supplier.email,
		address: supplier.address,
		notes: supplier.notes,
		isActive: supplier.isActive,
		createdAt: supplier.createdAt,
		updatedAt: supplier.updatedAt,
	};
};

const createMedication = async (user, body, req) => {
	if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
		throw new ServiceError('Request body is empty', 400);
	}

	const name = body.name ? String(body.name).trim() : '';
	if (!name) throw new ServiceError('name is required', 400);

	if (body.minStockLevel != null && (typeof body.minStockLevel !== 'number' || body.minStockLevel < 0)) {
		throw new ServiceError('minStockLevel must be a non-negative number', 400);
	}

	const medicationCode = body.medicationCode ? String(body.medicationCode).trim() : await generateMedicationCode();
	const existingCode = await medicationRepo.findByCode(medicationCode);
	if (existingCode) throw new ServiceError('medicationCode already exists', 409);

	const medication = await medicationRepo.create({
		medicationCode,
		name,
		form: body.form ? String(body.form).trim() : undefined,
		strength: body.strength ? String(body.strength).trim() : undefined,
		unit: body.unit ? String(body.unit).trim() : undefined,
		manufacturer: body.manufacturer ? String(body.manufacturer).trim() : undefined,
		description: body.description ? String(body.description).trim() : undefined,
		minStockLevel: body.minStockLevel ?? 0,
		createdBy: user._id,
		updatedBy: user._id,
	});

	await createAuditLog({
		actorUserId: user._id,
		actorRole: user.role,
		action: 'CREATE_MEDICATION',
		module: 'pharmacy',
		targetEntityType: 'Medication',
		targetEntityId: medication._id,
		afterData: { medicationCode: medication.medicationCode, name: medication.name },
		req,
	});

	return { message: 'Medication created successfully', medication: formatMedication(medication, 0) };
};

const updateMedication = async (user, medicationId, body, req) => {
	const medication = await medicationRepo.findById(medicationId);
	if (!medication) throw new ServiceError('Medication not found', 404);

	if (body.minStockLevel != null && (typeof body.minStockLevel !== 'number' || body.minStockLevel < 0)) {
		throw new ServiceError('minStockLevel must be a non-negative number', 400);
	}

	const updateData = { updatedBy: user._id };
	if (body.name) updateData.name = String(body.name).trim();
	if (body.form !== undefined) updateData.form = String(body.form || '').trim();
	if (body.strength !== undefined) updateData.strength = String(body.strength || '').trim();
	if (body.unit !== undefined) updateData.unit = String(body.unit || '').trim();
	if (body.manufacturer !== undefined) updateData.manufacturer = String(body.manufacturer || '').trim();
	if (body.description !== undefined) updateData.description = String(body.description || '').trim();
	if (body.minStockLevel != null) updateData.minStockLevel = body.minStockLevel;
	if (body.isActive !== undefined) updateData.isActive = Boolean(body.isActive);

	const updated = await medicationRepo.updateById(medicationId, updateData);

	await createAuditLog({
		actorUserId: user._id,
		actorRole: user.role,
		action: 'UPDATE_MEDICATION',
		module: 'pharmacy',
		targetEntityType: 'Medication',
		targetEntityId: medication._id,
		beforeData: { name: medication.name, minStockLevel: medication.minStockLevel, isActive: medication.isActive },
		afterData: { name: updated.name, minStockLevel: updated.minStockLevel, isActive: updated.isActive },
		req,
	});

	const available = await getAvailableQuantity(updated._id);
	return { message: 'Medication updated successfully', medication: formatMedication(updated, available) };
};

const listMedications = async (query) => {
	const filter = {};
	if (query.isActive === 'true' || query.isActive === true) {
		filter.isActive = true;
	} else if (query.isActive === 'false' || query.isActive === false) {
		filter.isActive = false;
	}
	// any other value (e.g. "all", undefined) means no filter — all statuses

	if (query.search) {
		const term = String(query.search).trim();
		filter.$or = [
			{ name: { $regex: term, $options: 'i' } },
			{ medicationCode: { $regex: term, $options: 'i' } },
			{ manufacturer: { $regex: term, $options: 'i' } },
		];
	}

	const { pageNum, limitNum, skip } = parsePagination(query);
	const sort = { createdAt: -1 };

	const [data, total] = await Promise.all([
		medicationRepo.findAll(filter, { sort, skip, limit: limitNum }),
		medicationRepo.countAll(filter),
	]);

	const availabilityMap = await getAvailabilityMap(data.map((item) => item._id));

	return {
		data: data.map((item) => formatMedication(item, availabilityMap[item._id.toString()] || 0)),
		total,
		page: pageNum,
		limit: limitNum,
		totalPages: Math.ceil(total / limitNum) || 1,
	};
};

const getMedication = async (medicationId) => {
	const medication = await medicationRepo.findById(medicationId);
	if (!medication) throw new ServiceError('Medication not found', 404);
	const available = await getAvailableQuantity(medication._id);
	return { medication: formatMedication(medication, available) };
};

const addMedicationNote = async (user, medicationId, body, req) => {
	const medication = await medicationRepo.findById(medicationId);
	if (!medication) throw new ServiceError('Medication not found', 404);

	const note = body.note ? String(body.note).trim() : '';
	if (!note) throw new ServiceError('note is required', 400);

	const created = await medicationNoteRepo.create({
		medicationId: medication._id,
		note,
		createdBy: user._id,
	});

	await createAuditLog({
		actorUserId: user._id,
		actorRole: user.role,
		action: 'ADD_MEDICATION_NOTE',
		module: 'pharmacy',
		targetEntityType: 'Medication',
		targetEntityId: medication._id,
		afterData: { note },
		req,
	});

	return { message: 'Medication note added', note: created };
};

const listMedicationNotes = async (medicationId, query) => {
	const medication = await medicationRepo.findById(medicationId);
	if (!medication) throw new ServiceError('Medication not found', 404);

	const { pageNum, limitNum, skip } = parsePagination(query);
	const sort = { createdAt: -1 };
	const [data, total] = await Promise.all([
		medicationNoteRepo.findByMedicationId(medicationId, { sort, skip, limit: limitNum }),
		medicationNoteRepo.countByMedicationId(medicationId),
	]);

	return {
		data,
		total,
		page: pageNum,
		limit: limitNum,
		totalPages: Math.ceil(total / limitNum) || 1,
	};
};

const createSupplier = async (user, body, req) => {
	if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
		throw new ServiceError('Request body is empty', 400);
	}

	const name = body.name ? String(body.name).trim() : '';
	if (!name) throw new ServiceError('name is required', 400);

	const existing = await supplierRepo.findByName(name);
	if (existing) throw new ServiceError('supplier name already exists', 409);

	const supplier = await supplierRepo.create({
		name,
		contactName: body.contactName ? String(body.contactName).trim() : undefined,
		phone: body.phone ? String(body.phone).trim() : undefined,
		email: body.email ? String(body.email).trim().toLowerCase() : undefined,
		address: body.address ? String(body.address).trim() : undefined,
		notes: body.notes ? String(body.notes).trim() : undefined,
		createdBy: user._id,
		updatedBy: user._id,
	});

	await createAuditLog({
		actorUserId: user._id,
		actorRole: user.role,
		action: 'CREATE_SUPPLIER',
		module: 'pharmacy',
		targetEntityType: 'Supplier',
		targetEntityId: supplier._id,
		afterData: { name: supplier.name },
		req,
	});

	return { message: 'Supplier created successfully', supplier: formatSupplier(supplier) };
};

const updateSupplier = async (user, supplierId, body, req) => {
	const supplier = await supplierRepo.findById(supplierId);
	if (!supplier) throw new ServiceError('Supplier not found', 404);

	if (body.name) {
		const existing = await supplierRepo.findByName(String(body.name).trim(), supplierId);
		if (existing) throw new ServiceError('supplier name already exists', 409);
	}

	const updateData = { updatedBy: user._id };
	if (body.name) updateData.name = String(body.name).trim();
	if (body.contactName !== undefined) updateData.contactName = String(body.contactName || '').trim();
	if (body.phone !== undefined) updateData.phone = String(body.phone || '').trim();
	if (body.email !== undefined) updateData.email = String(body.email || '').trim().toLowerCase();
	if (body.address !== undefined) updateData.address = String(body.address || '').trim();
	if (body.notes !== undefined) updateData.notes = String(body.notes || '').trim();
	if (body.isActive !== undefined) updateData.isActive = Boolean(body.isActive);

	const updated = await supplierRepo.updateById(supplierId, updateData);

	await createAuditLog({
		actorUserId: user._id,
		actorRole: user.role,
		action: 'UPDATE_SUPPLIER',
		module: 'pharmacy',
		targetEntityType: 'Supplier',
		targetEntityId: supplier._id,
		beforeData: { name: supplier.name, isActive: supplier.isActive },
		afterData: { name: updated.name, isActive: updated.isActive },
		req,
	});

	return { message: 'Supplier updated successfully', supplier: formatSupplier(updated) };
};

const deleteSupplier = async (user, supplierId, req) => {
	const supplier = await supplierRepo.findById(supplierId);
	if (!supplier) throw new ServiceError('Supplier not found', 404);
	if (!supplier.isActive) throw new ServiceError('Supplier is already inactive', 400);

	const updated = await supplierRepo.softDelete(supplierId, user._id);

	await createAuditLog({
		actorUserId: user._id,
		actorRole: user.role,
		action: 'DELETE_SUPPLIER',
		module: 'pharmacy',
		targetEntityType: 'Supplier',
		targetEntityId: supplier._id,
		beforeData: { isActive: true },
		afterData: { isActive: false },
		req,
	});

	return { message: 'Supplier deactivated', supplier: formatSupplier(updated) };
};

const listSuppliers = async (query) => {
	const filter = {};
	if (query.isActive === 'true' || query.isActive === true) {
		filter.isActive = true;
	} else if (query.isActive === 'false' || query.isActive === false) {
		filter.isActive = false;
	}
	// any other value (e.g. "all", undefined) means no filter — all statuses
	if (query.search) {
		const term = String(query.search).trim();
		filter.$or = [
			{ name: { $regex: term, $options: 'i' } },
			{ email: { $regex: term, $options: 'i' } },
			{ phone: { $regex: term, $options: 'i' } },
		];
	}

	const { pageNum, limitNum, skip } = parsePagination(query);
	const sort = { createdAt: -1 };

	const [data, total] = await Promise.all([
		supplierRepo.findAll(filter, { sort, skip, limit: limitNum }),
		supplierRepo.countAll(filter),
	]);

	return {
		data: data.map(formatSupplier),
		total,
		page: pageNum,
		limit: limitNum,
		totalPages: Math.ceil(total / limitNum) || 1,
	};
};

const getSupplier = async (supplierId) => {
	const supplier = await supplierRepo.findById(supplierId);
	if (!supplier) throw new ServiceError('Supplier not found', 404);
	return { supplier: formatSupplier(supplier) };
};

const createStock = async (user, body, req) => {
	if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
		throw new ServiceError('Request body is empty', 400);
	}

	if (!body.medicationId) throw new ServiceError('medicationId is required', 400);
	const medication = await medicationRepo.findById(body.medicationId);
	if (!medication) throw new ServiceError('Medication not found', 404);

	if (typeof body.quantity !== 'number' || body.quantity <= 0) {
		throw new ServiceError('quantity must be a positive number', 400);
	}

	let supplierId;
	if (body.supplierId) {
		const supplier = await supplierRepo.findById(body.supplierId);
		if (!supplier || !supplier.isActive) throw new ServiceError('Supplier not found', 404);
		supplierId = supplier._id;
	}

	const expiryDate = parseOptionalDate(body.expiryDate, 'expiryDate');
	const receivedDate = parseOptionalDate(body.receivedDate, 'receivedDate') || new Date();

	const stock = await medicationStockRepo.create({
		medicationId: medication._id,
		supplierId,
		quantity: body.quantity,
		unit: body.unit ? String(body.unit).trim() : medication.unit,
		lotNumber: body.lotNumber ? String(body.lotNumber).trim() : undefined,
		expiryDate,
		receivedDate,
		costPerUnit: body.costPerUnit,
		notes: body.notes ? String(body.notes).trim() : undefined,
	});

	await createAuditLog({
		actorUserId: user._id,
		actorRole: user.role,
		action: 'CREATE_MEDICATION_STOCK',
		module: 'pharmacy',
		targetEntityType: 'MedicationStock',
		targetEntityId: stock._id,
		afterData: { medicationId: medication._id, quantity: stock.quantity },
		req,
	});

	return { message: 'Stock received', stock };
};

const updateStock = async (user, stockId, body, req) => {
	const stock = await medicationStockRepo.findById(stockId);
	if (!stock) throw new ServiceError('Stock entry not found', 404);

	if (body.quantity != null && (typeof body.quantity !== 'number' || body.quantity < 0)) {
		throw new ServiceError('quantity must be a non-negative number', 400);
	}

	let supplierId = stock.supplierId;
	if (body.supplierId) {
		const supplier = await supplierRepo.findById(body.supplierId);
		if (!supplier || !supplier.isActive) throw new ServiceError('Supplier not found', 404);
		supplierId = supplier._id;
	}

	const updateData = {};
	if (body.quantity != null) updateData.quantity = body.quantity;
	if (body.unit !== undefined) updateData.unit = String(body.unit || '').trim();
	if (body.lotNumber !== undefined) updateData.lotNumber = String(body.lotNumber || '').trim();
	if (body.expiryDate !== undefined) updateData.expiryDate = parseOptionalDate(body.expiryDate, 'expiryDate');
	if (body.receivedDate !== undefined) updateData.receivedDate = parseOptionalDate(body.receivedDate, 'receivedDate');
	if (body.costPerUnit !== undefined) updateData.costPerUnit = body.costPerUnit;
	if (body.notes !== undefined) updateData.notes = String(body.notes || '').trim();
	if (supplierId) updateData.supplierId = supplierId;

	const updated = await medicationStockRepo.updateById(stockId, updateData);

	await createAuditLog({
		actorUserId: user._id,
		actorRole: user.role,
		action: 'UPDATE_MEDICATION_STOCK',
		module: 'pharmacy',
		targetEntityType: 'MedicationStock',
		targetEntityId: stock._id,
		beforeData: { quantity: stock.quantity },
		afterData: { quantity: updated.quantity },
		req,
	});

	return { message: 'Stock updated', stock: updated };
};

const listStocks = async (query) => {
	const filter = {};
	if (query.medicationId) filter.medicationId = query.medicationId;
	if (query.supplierId) filter.supplierId = query.supplierId;
	if (query.lotNumber) filter.lotNumber = { $regex: String(query.lotNumber).trim(), $options: 'i' };

	if (query.expiryFrom || query.expiryTo) {
		filter.expiryDate = {};
		if (query.expiryFrom) filter.expiryDate.$gte = parseOptionalDate(query.expiryFrom, 'expiryFrom');
		if (query.expiryTo) filter.expiryDate.$lte = parseOptionalDate(query.expiryTo, 'expiryTo');
	}

	const { pageNum, limitNum, skip } = parsePagination(query);
	const sort = { receivedDate: -1 };

	const [data, total] = await Promise.all([
		medicationStockRepo.findAll(filter, { sort, skip, limit: limitNum }),
		medicationStockRepo.countAll(filter),
	]);

	return {
		data,
		total,
		page: pageNum,
		limit: limitNum,
		totalPages: Math.ceil(total / limitNum) || 1,
	};
};

const dispenseMedication = async (user, body, req) => {
	if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
		throw new ServiceError('Request body is empty', 400);
	}

	if (!body.medicationId) throw new ServiceError('medicationId is required', 400);
	const medication = await medicationRepo.findById(body.medicationId);
	if (!medication) throw new ServiceError('Medication not found', 404);

	if (typeof body.quantity !== 'number' || body.quantity <= 0) {
		throw new ServiceError('quantity must be a positive number', 400);
	}

	if (body.prescriptionId) {
		const prescription = await Prescription.findById(body.prescriptionId);
		if (!prescription) throw new ServiceError('Prescription not found', 404);
		if (!prescription.isVerified) throw new ServiceError('Prescription must be verified before dispensing', 400);
		if (prescription.items && prescription.items.length > 0) {
			const matchingItem = prescription.items.find(
				(item) => item.medicationName && item.medicationName.toLowerCase() === medication.name.toLowerCase()
			);
			if (!matchingItem) {
				throw new ServiceError('Medication does not match any item in the prescription', 400);
			}
		}
	}

	const available = await getAvailableQuantity(medication._id);
	if (available < body.quantity) {
		throw new ServiceError(`Insufficient stock: available ${available}`, 400);
	}

	const dispensedAt = parseOptionalDate(body.dispensedAt, 'dispensedAt') || new Date();

	const dispense = await medicationDispenseRepo.create({
		medicationId: medication._id,
		prescriptionId: body.prescriptionId || undefined,
		residentId: body.residentId || undefined,
		quantity: body.quantity,
		dispensedByUserId: user._id,
		dispensedAt,
		notes: body.notes ? String(body.notes).trim() : undefined,
	});

	const postDispenseAvailable = await getAvailableQuantity(medication._id);
	if (postDispenseAvailable < 0) {
		await medicationDispenseRepo.deleteById(dispense._id);
		throw new ServiceError('Concurrent dispense detected: insufficient stock. Please retry.', 409);
	}

	await createAuditLog({
		actorUserId: user._id,
		actorRole: user.role,
		action: 'DISPENSE_MEDICATION',
		module: 'pharmacy',
		targetEntityType: 'MedicationDispense',
		targetEntityId: dispense._id,
		afterData: { medicationId: medication._id, quantity: dispense.quantity },
		req,
	});

	return { message: 'Medication dispensed', dispense };
};

const verifyPrescription = async (user, prescriptionId, req) => {
	const prescription = await Prescription.findById(prescriptionId);
	if (!prescription) throw new ServiceError('Prescription not found', 404);
	if (prescription.isVerified) throw new ServiceError('Prescription already verified', 400);

	prescription.isVerified = true;
	prescription.verifiedByUserId = user._id;
	prescription.verifiedAt = new Date();
	await prescription.save();

	await createAuditLog({
		actorUserId: user._id,
		actorRole: user.role,
		action: 'VERIFY_PRESCRIPTION',
		module: 'pharmacy',
		targetEntityType: 'Prescription',
		targetEntityId: prescription._id,
		afterData: { isVerified: true },
		req,
	});

	return { message: 'Prescription verified', prescription };
};

const getLowStockAlerts = async (query) => {
	const filter = { isActive: true, minStockLevel: { $gt: 0 } };
	if (query.search) {
		const term = String(query.search).trim();
		filter.$or = [
			{ name: { $regex: term, $options: 'i' } },
			{ medicationCode: { $regex: term, $options: 'i' } },
		];
	}

	const meds = await medicationRepo.findAll(filter, { sort: { name: 1 }, skip: 0, limit: 1000 });
	const availabilityMap = await getAvailabilityMap(meds.map((item) => item._id));

	const lowStock = meds
		.map((item) => ({
			medication: formatMedication(item, availabilityMap[item._id.toString()] || 0),
		}))
		.filter((item) => item.medication.availableQuantity <= item.medication.minStockLevel);

	return { data: lowStock, total: lowStock.length };
};

const trackExpiry = async (query) => {
	const withinDays = query.withinDays ? parseInt(query.withinDays, 10) : 30;
	if (Number.isNaN(withinDays) || withinDays <= 0) {
		throw new ServiceError('withinDays must be a positive number', 400);
	}

	const now = new Date();
	const toDate = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
	const data = await medicationStockRepo.findExpiring(now, toDate);

	return { data, withinDays };
};

const getUsageStats = async (query) => {
	const now = new Date();
	const toDate = query.to ? parseOptionalDate(query.to, 'to') : now;
	const fromDate = query.from
		? parseOptionalDate(query.from, 'from')
		: new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);

	const usage = await medicationDispenseRepo.aggregateUsage(fromDate, toDate);
	const medicationIds = usage.map((row) => row._id);
	const medications = await medicationRepo.findByIds(medicationIds);
	const medMap = {};
	medications.forEach((med) => {
		medMap[med._id.toString()] = med;
	});

	const data = usage.map((row) => ({
		medication: medMap[row._id.toString()] ? formatMedication(medMap[row._id.toString()], 0) : { _id: row._id },
		totalDispensed: row.totalDispensed,
		dispenseCount: row.count,
	}));

	return { from: fromDate, to: toDate, data };
};

const getReportSummary = async (query) => {
	const now = new Date();
	const toDate = query.to ? parseOptionalDate(query.to, 'to') : now;
	const fromDate = query.from
		? parseOptionalDate(query.from, 'from')
		: new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);

	const [medicationCount, supplierCount, lowStock, expiring, usage] = await Promise.all([
		medicationRepo.countAll({ isActive: true }),
		supplierRepo.countAll({ isActive: true }),
		getLowStockAlerts({}),
		trackExpiry({ withinDays: 30 }),
		getUsageStats({ from: fromDate, to: toDate }),
	]);

	const totalDispensed = usage.data.reduce((sum, row) => sum + (row.totalDispensed || 0), 0);

	return {
		from: fromDate,
		to: toDate,
		summary: {
			activeMedications: medicationCount,
			activeSuppliers: supplierCount,
			lowStockCount: lowStock.total,
			expiringSoonCount: expiring.data.length,
			totalDispensed,
		},
	};
};

module.exports = {
	createMedication,
	updateMedication,
	listMedications,
	getMedication,
	addMedicationNote,
	listMedicationNotes,
	createSupplier,
	updateSupplier,
	deleteSupplier,
	listSuppliers,
	getSupplier,
	createStock,
	updateStock,
	listStocks,
	dispenseMedication,
	verifyPrescription,
	getLowStockAlerts,
	trackExpiry,
	getUsageStats,
	getReportSummary,
};
