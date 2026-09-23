const ServiceError = require('./serviceError');
const { createAuditLog } = require('../utils/auditLog');
const medicationRepo = require('../repositories/medicationRepository');
const medicationStockRepo = require('../repositories/medicationStockRepository');
const medicationDispenseRepo = require('../repositories/medicationDispenseRepository');
const medicationNoteRepo = require('../repositories/medicationNoteRepository');
const supplierRepo = require('../repositories/supplierRepository');
const prescriptionRepo = require('../repositories/prescriptionRepository');

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
		throw new ServiceError(`${fieldName} không hợp lệ`, 400);
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
	throw new ServiceError('Không thể tạo mã thuốc', 500);
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
		price: medication.price,
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
		throw new ServiceError('Nội dung yêu cầu trống', 400);
	}

	const name = body.name ? String(body.name).trim() : '';
	if (!name) throw new ServiceError('name là bắt buộc', 400);

	if (!/^[A-Za-z]/.test(name)) throw new ServiceError('name phải bắt đầu bằng một chữ cái', 400);

	const minStockLevel = Number(body.minStockLevel);
	if (body.minStockLevel == null || Number.isNaN(minStockLevel) || minStockLevel < 0) {
		throw new ServiceError('minStockLevel phải là số không âm', 400);
	}

	const medicationCode = body.medicationCode ? String(body.medicationCode).trim() : await generateMedicationCode();

	const existingCode = await medicationRepo.findByCode(medicationCode);
	if (existingCode) throw new ServiceError('medicationCode đã tồn tại', 409);

	const medication = await medicationRepo.create({
		medicationCode,
		name,
		form: body.form ? String(body.form).trim() : undefined,
		strength: body.strength ? String(body.strength).trim() : undefined,
		unit: body.unit ? String(body.unit).trim() : undefined,
		manufacturer: body.manufacturer ? String(body.manufacturer).trim() : undefined,
		description: body.description ? String(body.description).trim() : undefined,
		minStockLevel: body.minStockLevel ?? 0,
		price: body.price != null && body.price !== '' ? Number(body.price) : undefined,
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
		targetName: medication.name,
		afterData: {
			medicationCode: medication.medicationCode,
			name: medication.name,
			form: medication.form,
			strength: medication.strength,
			unit: medication.unit,
			manufacturer: medication.manufacturer,
			minStockLevel: medication.minStockLevel,
			isActive: medication.isActive,
			price: medication.price,
		},
		req,
	});

	return { message: 'Đã tạo thuốc thành công', medication: formatMedication(medication, 0) };
};

const updateMedication = async (user, medicationId, body, req) => {
	const medication = await medicationRepo.findById(medicationId);
	if (!medication) throw new ServiceError('Không tìm thấy thuốc', 404);

	if (body.minStockLevel != null && (typeof body.minStockLevel !== 'number' || body.minStockLevel < 0)) {
		throw new ServiceError('minStockLevel phải là số không âm', 400);
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
	if (body.price != null && body.price !== '') updateData.price = Number(body.price);

	const updated = await medicationRepo.updateById(medicationId, updateData);

	await createAuditLog({
		actorUserId: user._id,
		actorRole: user.role,
		action: 'UPDATE_MEDICATION',
		module: 'pharmacy',
		targetEntityType: 'Medication',
		targetEntityId: medication._id,
		targetName: medication.name,
		beforeData: {
			name: medication.name,
			form: medication.form,
			strength: medication.strength,
			unit: medication.unit,
			manufacturer: medication.manufacturer,
			minStockLevel: medication.minStockLevel,
			isActive: medication.isActive,
			price: medication.price,
		},
		afterData: {
			name: updated.name,
			form: updated.form,
			strength: updated.strength,
			unit: updated.unit,
			manufacturer: updated.manufacturer,
			minStockLevel: updated.minStockLevel,
			isActive: updated.isActive,
			price: updated.price,
		},
		req,
	});

	const available = await getAvailableQuantity(updated._id);
	return { message: 'Đã cập nhật thuốc thành công', medication: formatMedication(updated, available) };
};

const updateSellingPrice = async (user, medicationId, body, req) => {
	const medication = await medicationRepo.findById(medicationId);
	if (!medication) throw new ServiceError('Không tìm thấy thuốc', 404);

	const { sellingPrice } = body;
	if (sellingPrice == null || sellingPrice === '' || isNaN(Number(sellingPrice)) || Number(sellingPrice) < 0) {
		throw new ServiceError('Đơn giá bán phải là số không âm', 400);
	}

	const updateData = {
		price: Number(sellingPrice),
		updatedBy: user._id,
	};

	const updated = await medicationRepo.updateById(medicationId, updateData);

	await createAuditLog({
		actorUserId: user._id,
		actorRole: user.role,
		action: 'UPDATE_SELLING_PRICE',
		module: 'pharmacy',
		targetEntityType: 'Medication',
		targetEntityId: medication._id,
		targetName: medication.name,
		beforeData: { price: medication.price },
		afterData: { price: updated.price },
		req,
	});

	return { message: 'Đã cập nhật đơn giá bán thành công', medication: formatMedication(updated, null) };
};

const listMedications = async (query) => {
	const filter = {};
	if (query.isActive === 'true' || query.isActive === true) {
		filter.isActive = true;
	} else if (query.isActive === 'false' || query.isActive === false) {
		filter.isActive = false;
	}

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
	if (!medication) throw new ServiceError('Không tìm thấy thuốc', 404);
	const available = await getAvailableQuantity(medication._id);
	return { medication: formatMedication(medication, available) };
};

const addMedicationNote = async (user, medicationId, body, req) => {
	const medication = await medicationRepo.findById(medicationId);
	if (!medication) throw new ServiceError('Không tìm thấy thuốc', 404);

	const note = body.note ? String(body.note).trim() : '';
	if (!note) throw new ServiceError('note là bắt buộc', 400);

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
		targetName: medication.name,
		afterData: { note },
		req,
	});

	return { message: 'Đã thêm ghi chú thuốc', note: created };
};

const listMedicationNotes = async (medicationId, query) => {
	const medication = await medicationRepo.findById(medicationId);
	if (!medication) throw new ServiceError('Không tìm thấy thuốc', 404);

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
		throw new ServiceError('Nội dung yêu cầu trống', 400);
	}

	const name = body.name ? String(body.name).trim() : '';
	if (!name) throw new ServiceError('name là bắt buộc', 400);

	const existing = await supplierRepo.findByName(name);
	if (existing) throw new ServiceError('Tên nhà cung cấp đã tồn tại', 409);

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
		targetName: supplier.name,
		afterData: {
			name: supplier.name,
			contactName: supplier.contactName,
			phone: supplier.phone,
			email: supplier.email,
			address: supplier.address,
			notes: supplier.notes,
			isActive: supplier.isActive,
		},
		req,
	});

	return { message: 'Đã tạo nhà cung cấp thành công', supplier: formatSupplier(supplier) };
};

const updateSupplier = async (user, supplierId, body, req) => {
	const supplier = await supplierRepo.findById(supplierId);
	if (!supplier) throw new ServiceError('Không tìm thấy nhà cung cấp', 404);

	if (body.name) {
		const existing = await supplierRepo.findByName(String(body.name).trim(), supplierId);
		if (existing) throw new ServiceError('Tên nhà cung cấp đã tồn tại', 409);
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
		targetName: supplier.name,
		beforeData: {
			name: supplier.name,
			contactName: supplier.contactName,
			phone: supplier.phone,
			email: supplier.email,
			address: supplier.address,
			notes: supplier.notes,
			isActive: supplier.isActive,
		},
		afterData: {
			name: updated.name,
			contactName: updated.contactName,
			phone: updated.phone,
			email: updated.email,
			address: updated.address,
			notes: updated.notes,
			isActive: updated.isActive,
		},
		req,
	});

	return { message: 'Đã cập nhật nhà cung cấp thành công', supplier: formatSupplier(updated) };
};

const deleteSupplier = async (user, supplierId, req) => {
	const supplier = await supplierRepo.findById(supplierId);
	if (!supplier) throw new ServiceError('Không tìm thấy nhà cung cấp', 404);
	if (!supplier.isActive) throw new ServiceError('Nhà cung cấp đã ngừng hoạt động', 400);

	const updated = await supplierRepo.softDelete(supplierId, user._id);

	await createAuditLog({
		actorUserId: user._id,
		actorRole: user.role,
		action: 'DELETE_SUPPLIER',
		module: 'pharmacy',
		targetEntityType: 'Supplier',
		targetEntityId: supplier._id,
		targetName: supplier.name,
		beforeData: { isActive: true },
		afterData: { isActive: false },
		req,
	});

	return { message: 'Đã ngừng hoạt động nhà cung cấp', supplier: formatSupplier(updated) };
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
	if (!supplier) throw new ServiceError('Không tìm thấy nhà cung cấp', 404);
	return { supplier: formatSupplier(supplier) };
};

const createStock = async (user, body, req) => {
	if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
		throw new ServiceError('Nội dung yêu cầu trống', 400);
	}

	if (!body.medicationId) throw new ServiceError('medicationId là bắt buộc', 400);
	const medication = await medicationRepo.findById(body.medicationId);
	if (!medication) throw new ServiceError('Không tìm thấy thuốc', 404);
	if (medication.isActive === false) throw new ServiceError('Thuốc đã ngừng hoạt động', 400);

	if (typeof body.quantity !== 'number' || body.quantity <= 0) {
		throw new ServiceError('quantity phải là số dương', 400);
	}

	let supplierId;
	if (body.supplierId) {
		const supplier = await supplierRepo.findById(body.supplierId);
		if (!supplier || !supplier.isActive) throw new ServiceError('Nhà cung cấp đã ngừng hoạt động', 400);
		supplierId = supplier._id;
	}

	const expiryDate = parseOptionalDate(body.expiryDate, 'expiryDate');
	const receivedDate = parseOptionalDate(body.receivedDate, 'receivedDate') || new Date();

	if (expiryDate && receivedDate) {
		const minExpiry = new Date(receivedDate.getTime() + 365 * 24 * 60 * 60 * 1000);
		if (expiryDate <= minExpiry) {
			throw new ServiceError('Ngày hết hạn phải lớn hơn 12 tháng kể từ ngày nhập thuốc', 400);
		}
	}

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
		targetName: `${medication.name} - lô ${stock.lotNumber || 'N/A'}`,
		afterData: {
			medicationName: medication.name,
			supplierName: supplierId ? (await supplierRepo.findById(supplierId))?.name : undefined,
			quantity: stock.quantity,
			unit: stock.unit,
			lotNumber: stock.lotNumber,
			expiryDate: stock.expiryDate,
			receivedDate: stock.receivedDate,
			costPerUnit: stock.costPerUnit,
			notes: stock.notes,
		},
		req,
	});

	return { message: 'Đã nhận hàng vào kho', stock };
};

const updateStock = async (user, stockId, body, req) => {
	const stock = await medicationStockRepo.findById(stockId);
	if (!stock) throw new ServiceError('Không tìm thấy phiếu nhập kho', 404);

	const stockMedication = await medicationRepo.findById(stock.medicationId);

	if (body.quantity != null && (typeof body.quantity !== 'number' || body.quantity < 0)) {
		throw new ServiceError('quantity phải là số không âm', 400);
	}

	let supplierId = stock.supplierId;
	if (body.supplierId) {
		const supplier = await supplierRepo.findById(body.supplierId);
		if (!supplier || !supplier.isActive) throw new ServiceError('Không tìm thấy nhà cung cấp', 404);
		supplierId = supplier._id;
	}

	const updateData = {};
	if (body.medicationId) {
		const medication = await medicationRepo.findById(body.medicationId);
		if (!medication) throw new ServiceError('Không tìm thấy thuốc', 404);
		updateData.medicationId = medication._id;
	}
	if (body.quantity != null) updateData.quantity = body.quantity;
	if (body.unit !== undefined) updateData.unit = String(body.unit || '').trim();
	if (body.lotNumber !== undefined) updateData.lotNumber = String(body.lotNumber || '').trim();
	if (body.expiryDate !== undefined) updateData.expiryDate = parseOptionalDate(body.expiryDate, 'expiryDate');
	if (body.receivedDate !== undefined) updateData.receivedDate = parseOptionalDate(body.receivedDate, 'receivedDate');
	if (body.costPerUnit !== undefined) updateData.costPerUnit = body.costPerUnit;
	if (body.notes !== undefined) updateData.notes = String(body.notes || '').trim();
	if (supplierId) updateData.supplierId = supplierId;

	const finalExpiry = updateData.expiryDate !== undefined ? updateData.expiryDate : stock.expiryDate;
	const finalReceived = updateData.receivedDate !== undefined ? updateData.receivedDate : stock.receivedDate;
	if (finalExpiry && finalReceived) {
		const minExpiry = new Date(finalReceived.getTime() + 365 * 24 * 60 * 60 * 1000);
		if (finalExpiry <= minExpiry) {
			throw new ServiceError('Ngày hết hạn phải lớn hơn 12 tháng kể từ ngày nhập thuốc', 400);
		}
	}

	const updated = await medicationStockRepo.updateById(stockId, updateData);

	const [beforeSupplier, afterSupplier] = await Promise.all([
		stock.supplierId ? supplierRepo.findById(stock.supplierId) : null,
		updated.supplierId ? supplierRepo.findById(updated.supplierId) : null,
	]);

	await createAuditLog({
		actorUserId: user._id,
		actorRole: user.role,
		action: 'UPDATE_MEDICATION_STOCK',
		module: 'pharmacy',
		targetEntityType: 'MedicationStock',
		targetEntityId: stock._id,
		targetName: stockMedication ? `${stockMedication.name} - lô ${updated.lotNumber || stock.lotNumber || 'N/A'}` : undefined,
		beforeData: {
			medicationName: stockMedication?.name,
			supplierName: beforeSupplier?.name,
			quantity: stock.quantity,
			unit: stock.unit,
			lotNumber: stock.lotNumber,
			expiryDate: stock.expiryDate,
			receivedDate: stock.receivedDate,
			costPerUnit: stock.costPerUnit,
			notes: stock.notes,
		},
		afterData: {
			medicationName: stockMedication?.name,
			supplierName: afterSupplier?.name,
			quantity: updated.quantity,
			unit: updated.unit,
			lotNumber: updated.lotNumber,
			expiryDate: updated.expiryDate,
			receivedDate: updated.receivedDate,
			costPerUnit: updated.costPerUnit,
			notes: updated.notes,
		},
		req,
	});

	return { message: 'Đã cập nhật tồn kho', stock: updated };
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
		throw new ServiceError('Nội dung yêu cầu trống', 400);
	}

	if (!body.medicationId) throw new ServiceError('medicationId là bắt buộc', 400);
	const medication = await medicationRepo.findById(body.medicationId);
	if (!medication) throw new ServiceError('Không tìm thấy thuốc', 404);

	if (typeof body.quantity !== 'number' || body.quantity <= 0) {
		throw new ServiceError('quantity phải là số dương', 400);
	}

	if (body.prescriptionId) {
		const prescription = await prescriptionRepo.findById(body.prescriptionId);
		if (!prescription) throw new ServiceError('Không tìm thấy đơn thuốc', 404);
		if (!prescription.isVerified) throw new ServiceError('Đơn thuốc phải được xác minh trước khi cấp phát', 400);
		if (prescription.items && prescription.items.length > 0) {
			const matchingItem = prescription.items.find(
				(item) => item.medicationName && item.medicationName.toLowerCase() === medication.name.toLowerCase()
			);
			if (!matchingItem) {
				throw new ServiceError('Thuốc không khớp với bất kỳ mục nào trong đơn thuốc', 400);
			}
		}
	}

	const available = await getAvailableQuantity(medication._id);
	if (available < body.quantity) {
		throw new ServiceError(`Không đủ tồn kho: còn lại ${available}`, 400);
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
		throw new ServiceError('Phát hiện cấp phát đồng thời: không đủ tồn kho. Vui lòng thử lại.', 409);
	}

	await createAuditLog({
		actorUserId: user._id,
		actorRole: user.role,
		action: 'DISPENSE_MEDICATION',
		module: 'pharmacy',
		targetEntityType: 'MedicationDispense',
		targetEntityId: dispense._id,
		targetName: medication.name,
		afterData: { medicationId: medication._id, quantity: dispense.quantity },
		req,
	});

	return { message: 'Đã xuất thuốc', dispense };
};

const verifyPrescription = async (user, prescriptionId, req) => {
	const prescription = await prescriptionRepo.findById(prescriptionId);
	if (!prescription) throw new ServiceError('Không tìm thấy đơn thuốc', 404);
	if (prescription.isVerified) throw new ServiceError('Đơn thuốc đã được xác minh', 400);

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

	return { message: 'Đã xác minh đơn thuốc', prescription };
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
	const hasWithinDays = query && query.withinDays !== undefined && query.withinDays !== null && query.withinDays !== '';
	const withinDays = hasWithinDays ? parseInt(query.withinDays, 10) : null;
	if (hasWithinDays && (Number.isNaN(withinDays) || withinDays <= 0)) {
		throw new ServiceError('withinDays phải là số dương', 400);
	}

	const now = new Date();
	const toDate = withinDays ? new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000) : undefined;
	const fromDate = withinDays ? now : undefined;
	const data = await medicationStockRepo.findExpiring(fromDate, toDate);

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

	const detailedRecords = await medicationDispenseRepo.findDetailedRecords(fromDate, toDate);
	const dispensingDetails = detailedRecords.map((record) => ({
		medicationName: record.medicationId?.name || 'N/A',
		medication: record.medicationId,
		medicationUnit: record.medicationId?.unit || 'N/A',
		patientName: record.residentId?.fullName || 'N/A',
		patient: record.residentId,
		quantity: record.quantity,
		dispensedTime: record.dispensedAt,
		dispensedBy: record.dispensedByUserId?.fullName || 'N/A',
		notes: record.notes || '',
	}));

	return { 
		from: fromDate, 
		to: toDate, 
		data,
		dispensingDetails,
	};
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
		trackExpiry({ withinDays: 365 }),
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
	updateSellingPrice,
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
