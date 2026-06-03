const mongoose = require('mongoose');
const ServiceError = require('./serviceError');
const {
  Resident,
  Incident,
  Activity,
  CareTask,
  CareAppointment,
  Invoice,
  Payment,
  MedicalRecord,
  ReportSnapshot,
} = require('../models');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

const parseDateRange = (query, fromKey = 'from', toKey = 'to') => {
  const range = {};
  if (query[fromKey]) {
    const from = new Date(query[fromKey]);
    if (!Number.isNaN(from.getTime())) range.$gte = from;
  }
  if (query[toKey]) {
    const to = new Date(query[toKey]);
    if (!Number.isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      range.$lte = to;
    }
  }
  return Object.keys(range).length ? range : null;
};

const parsePagination = (query) => {
  const page = Math.max(DEFAULT_PAGE, Number.parseInt(query.page || DEFAULT_PAGE, 10));
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit || DEFAULT_LIMIT, 10)));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const buildTimeGroup = (granularity, fieldName) => {
  const dateField = `$${fieldName}`;
  switch ((granularity || 'day').toLowerCase()) {
    case 'week':
      return {
        $dateToString: { format: '%Y-%U', date: dateField },
      };
    case 'month':
      return {
        $dateToString: { format: '%Y-%m', date: dateField },
      };
    default:
      return {
        $dateToString: { format: '%Y-%m-%d', date: dateField },
      };
  }
};

const buildReportFilter = (query, dateField) => {
  const filter = {};
  if (query.residentId) filter.residentId = query.residentId;
  if (query.status) filter.status = query.status;
  if (query.severity) filter.severity = query.severity;
  if (query.category) filter.category = query.category;
  if (query.incidentType) filter.incidentType = query.incidentType;
  if (query.taskType) filter.taskType = query.taskType;
  if (query.careLevel) filter.careLevel = query.careLevel;
  if (query.roomId) filter.roomId = query.roomId;
  if (query.servicePackage) filter.servicePackage = query.servicePackage;
  if (query.search) {
    const escaped = String(query.search).trim();
    if (escaped) {
      filter.$or = [
        { fullName: { $regex: escaped, $options: 'i' } },
        { incidentType: { $regex: escaped, $options: 'i' } },
        { title: { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
      ];
    }
  }

  const dateRange = buildDateRangeFilter(query, dateField);
  if (dateRange) filter[dateField] = dateRange;

  return filter;
};

const buildDateRangeFilter = (query, fieldName = 'createdAt') => {
  const range = parseDateRange(query);
  if (!range || !fieldName) return null;
  return range;
};

const getResidentCountReport = async (query) => {
  const filter = {};
  if (query.residencyStatus) filter.residencyStatus = query.residencyStatus;
  if (query.servicePackage) filter.servicePackage = query.servicePackage;
  if (query.roomId) filter.roomId = query.roomId;

  const [total, statuses, packages, rooms] = await Promise.all([
    Resident.countDocuments(filter),
    Resident.aggregate([
      { $match: filter },
      { $group: { _id: '$residencyStatus', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Resident.aggregate([
      { $match: filter },
      { $group: { _id: '$servicePackage', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Resident.aggregate([
      { $match: filter },
      { $group: { _id: '$roomId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  return {
    totalResidents: total,
    statuses: statuses.map((item) => ({ residencyStatus: item._id || 'unknown', count: item.count })),
    servicePackages: packages.map((item) => ({ servicePackage: item._id || 'unknown', count: item.count })),
    rooms: rooms.map((item) => ({ roomId: item._id, count: item.count })),
    generatedAt: new Date(),
    filters: query,
  };
};

const getSummaryReport = async (query) => {
  const incidentRange = buildDateRangeFilter(query, 'incidentAt');
  const activityRange = buildDateRangeFilter(query, 'scheduledAt');
  const invoiceRange = buildDateRangeFilter(query, 'issuedAt');
  const paymentRange = buildDateRangeFilter(query, 'paidAt');

  const [
    totalResidents,
    activeResidents,
    pendingResidents,
    dischargedResidents,
    totalIncidents,
    openIncidents,
    resolvedIncidents,
    totalActivities,
    completedActivities,
    scheduledActivities,
    invoiceMetrics,
    paymentMetrics,
  ] = await Promise.all([
    Resident.countDocuments(),
    Resident.countDocuments({ residencyStatus: 'active' }),
    Resident.countDocuments({ residencyStatus: 'pending' }),
    Resident.countDocuments({ residencyStatus: 'discharged' }),
    Incident.countDocuments(incidentRange ? { incidentAt: incidentRange } : {}),
    Incident.countDocuments({ ...(incidentRange ? { incidentAt: incidentRange } : {}), status: 'open' }),
    Incident.countDocuments({ ...(incidentRange ? { incidentAt: incidentRange } : {}), status: 'resolved' }),
    Activity.countDocuments(activityRange ? { scheduledAt: activityRange } : {}),
    Activity.countDocuments({ ...(activityRange ? { scheduledAt: activityRange } : {}), status: 'completed' }),
    Activity.countDocuments({ ...(activityRange ? { scheduledAt: activityRange } : {}), status: 'scheduled' }),
    Invoice.aggregate([
      { $match: invoiceRange ? { issuedAt: invoiceRange } : {} },
      {
        $group: {
          _id: null,
          totalInvoices: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          paidAmount: { $sum: '$roomCost' },
        },
      },
    ]),
    Payment.aggregate([
      { $match: paymentRange ? { paidAt: paymentRange, paymentStatus: 'confirmed' } : { paymentStatus: 'confirmed' } },
      {
        $group: {
          _id: null,
          totalPayments: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
        },
      },
    ]),
  ]);

  const invoiceSummary = invoiceMetrics[0] || { totalInvoices: 0, totalAmount: 0, paidAmount: 0 };
  const paymentSummary = paymentMetrics[0] || { totalPayments: 0, totalAmount: 0 };

  const outstandingAmount = invoiceSummary.totalAmount - paymentSummary.totalAmount;

  return {
    period: { from: query.from || null, to: query.to || null },
    totalResidents,
    activeResidents,
    pendingResidents,
    dischargedResidents,
    totalIncidents,
    openIncidents,
    resolvedIncidents,
    totalActivities,
    completedActivities,
    scheduledActivities,
    invoiceSummary: {
      totalInvoices: invoiceSummary.totalInvoices,
      totalAmount: invoiceSummary.totalAmount,
      outstandingAmount: outstandingAmount < 0 ? 0 : outstandingAmount,
    },
    paymentSummary: {
      totalPayments: paymentSummary.totalPayments,
      totalAmount: paymentSummary.totalAmount,
    },
    generatedAt: new Date(),
  };
};

const getHealthStatusReport = async (query) => {
  const filter = {};
  if (query.residentId) filter.residentId = new mongoose.Types.ObjectId(query.residentId);
  const range = buildDateRangeFilter(query, 'measuredAt');
  if (range) filter.measuredAt = range;

  const [totalRecords, abnormalRecords] = await Promise.all([
    MedicalRecord.countDocuments(filter),
    MedicalRecord.countDocuments({ ...filter, abnormalFlag: true }),
  ]);

  const topResidents = await MedicalRecord.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$residentId',
        totalRecords: { $sum: 1 },
        abnormalCount: { $sum: { $cond: ['$abnormalFlag', 1, 0] } },
        lastMeasuredAt: { $max: '$measuredAt' },
      },
    },
    { $sort: { abnormalCount: -1, totalRecords: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'residents',
        localField: '_id',
        foreignField: '_id',
        as: 'resident',
      },
    },
    { $unwind: { path: '$resident', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        residentId: '$_id',
        residentName: '$resident.fullName',
        totalRecords: 1,
        abnormalCount: 1,
        abnormalRatio: {
          $cond: [{ $gt: ['$totalRecords', 0] }, { $divide: ['$abnormalCount', '$totalRecords'] }, 0],
        },
        lastMeasuredAt: 1,
      },
    },
  ]);

  return {
    totalRecords,
    abnormalRecords,
    normalRecords: totalRecords - abnormalRecords,
    abnormalRatio: totalRecords ? abnormalRecords / totalRecords : 0,
    topResidents,
    generatedAt: new Date(),
    filters: query,
  };
};

const getIncidentReport = async (query) => {
  const filter = {};
  if (query.residentId) filter.residentId = query.residentId;
  if (query.status) filter.status = query.status;
  if (query.severity) filter.severity = query.severity;
  if (query.incidentType) filter.incidentType = query.incidentType;
  if (query.search) {
    const escaped = String(query.search).trim();
    if (escaped) {
      filter.$or = [
        { incidentType: { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
        { location: { $regex: escaped, $options: 'i' } },
        { reporterName: { $regex: escaped, $options: 'i' } },
      ];
    }
  }
  const range = parseDateRange(query, 'incidentFrom', 'incidentTo');
  if (range) filter.incidentAt = range;

  const { page, limit, skip } = parsePagination(query);
  const sort = { incidentAt: query.sortOrder === 'asc' ? 1 : -1 };

  const [incidents, total, statusBreakdown, severityBreakdown, typeBreakdown] = await Promise.all([
    Incident.find(filter)
      .populate('residentId', 'fullName')
      .sort(sort)
      .skip(skip)
      .limit(limit),
    Incident.countDocuments(filter),
    Incident.aggregate([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Incident.aggregate([
      { $match: filter },
      { $group: { _id: '$severity', count: { $sum: 1 } } },
    ]),
    Incident.aggregate([
      { $match: filter },
      { $group: { _id: '$incidentType', count: { $sum: 1 } } },
    ]),
  ]);

  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    incidents,
    statusBreakdown: statusBreakdown.map((item) => ({ status: item._id || 'unknown', count: item.count })),
    severityBreakdown: severityBreakdown.map((item) => ({ severity: item._id || 'unknown', count: item.count })),
    typeBreakdown: typeBreakdown.map((item) => ({ incidentType: item._id || 'unknown', count: item.count })),
    generatedAt: new Date(),
    filters: query,
  };
};

const getCareActivityReport = async (query) => {
  const activityFilter = {};
  const taskFilter = {};
  if (query.status) {
    activityFilter.status = query.status;
    taskFilter.status = query.status;
  }
  if (query.category) activityFilter.category = query.category;
  if (query.taskType) taskFilter.taskType = query.taskType;
  if (query.residentId) {
    activityFilter.participantResidentIds = query.residentId;
    taskFilter.residentId = query.residentId;
  }

  const activityRange = buildDateRangeFilter(query, 'scheduledAt');
  if (activityRange) activityFilter.scheduledAt = activityRange;
  const taskRange = buildDateRangeFilter(query, 'workDate');
  if (taskRange) taskFilter.workDate = taskRange;

  const [
    totalActivities,
    activitiesByStatus,
    activitiesByCategory,
    totalTasks,
    tasksByStatus,
    tasksByType,
  ] = await Promise.all([
    Activity.countDocuments(activityFilter),
    Activity.aggregate([
      { $match: activityFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Activity.aggregate([
      { $match: activityFilter },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]),
    CareTask.countDocuments(taskFilter),
    CareTask.aggregate([
      { $match: taskFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    CareTask.aggregate([
      { $match: taskFilter },
      { $group: { _id: '$taskType', count: { $sum: 1 } } },
    ]),
  ]);

  return {
    totalActivities,
    activitiesByStatus: activitiesByStatus.map((item) => ({ status: item._id || 'unknown', count: item.count })),
    activitiesByCategory: activitiesByCategory.map((item) => ({ category: item._id || 'unknown', count: item.count })),
    totalTasks,
    tasksByStatus: tasksByStatus.map((item) => ({ status: item._id || 'unknown', count: item.count })),
    tasksByType: tasksByType.map((item) => ({ taskType: item._id || 'unknown', count: item.count })),
    generatedAt: new Date(),
    filters: query,
  };
};

const getFinancialReport = async (query) => {
  const range = buildDateRangeFilter(query, 'issuedAt');
  const invoiceFilter = range ? { issuedAt: range } : {};
  const paymentFilter = buildDateRangeFilter(query, 'paidAt') || {};

  const [invoiceSummary, paymentSummary, overdueInvoices] = await Promise.all([
    Invoice.aggregate([
      { $match: invoiceFilter },
      {
        $group: {
          _id: null,
          totalInvoices: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          issuedAmount: { $sum: '$totalAmount' },
        },
      },
    ]),
    Payment.aggregate([
      { $match: { ...paymentFilter, paymentStatus: 'confirmed' } },
      {
        $group: {
          _id: null,
          totalPayments: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
        },
      },
    ]),
    Invoice.countDocuments({
      ...(query.dueFrom || query.dueTo ? { dueDate: parseDateRange(query, 'dueFrom', 'dueTo') } : {}),
      dueDate: { $lt: new Date() },
      status: { $ne: 'paid' },
    }),
  ]);

  const invoiceData = invoiceSummary[0] || { totalInvoices: 0, totalAmount: 0, issuedAmount: 0 };
  const paymentData = paymentSummary[0] || { totalPayments: 0, totalAmount: 0 };
  const outstandingAmount = Math.max(0, invoiceData.totalAmount - paymentData.totalAmount);

  return {
    period: { from: query.from || null, to: query.to || null },
    invoiceSummary: {
      totalInvoices: invoiceData.totalInvoices,
      totalAmount: invoiceData.totalAmount,
      outstandingAmount,
      overdueInvoices,
    },
    paymentSummary: {
      totalPayments: paymentData.totalPayments,
      totalAmount: paymentData.totalAmount,
    },
    generatedAt: new Date(),
    filters: query,
  };
};

const getTimeSeriesReport = async (query) => {
  const metric = query.metric || 'incidents';
  const granularity = query.granularity || 'day';
  const range = buildDateRangeFilter(query, query.metric === 'residentAdmissions' ? 'admittedAt' : query.metric === 'payments' ? 'paidAt' : query.metric === 'invoiceRevenue' ? 'issuedAt' : query.metric === 'activities' ? 'scheduledAt' : 'incidentAt');

  let collection;
  let dateField;
  let label;
  let valueField;
  let match;

  switch (metric) {
    case 'residentAdmissions':
      collection = Resident;
      dateField = 'admittedAt';
      label = 'Resident Admissions';
      valueField = null;
      break;
    case 'invoiceRevenue':
      collection = Invoice;
      dateField = 'issuedAt';
      label = 'Invoice Revenue';
      valueField = 'totalAmount';
      match = { ...range ? { issuedAt: range } : {} };
      break;
    case 'payments':
      collection = Payment;
      dateField = 'paidAt';
      label = 'Payments Received';
      valueField = 'amount';
      match = { paymentStatus: 'confirmed', ...(range ? { paidAt: range } : {}) };
      break;
    case 'activities':
      collection = Activity;
      dateField = 'scheduledAt';
      label = 'Activities';
      valueField = null;
      break;
    default:
      collection = Incident;
      dateField = 'incidentAt';
      label = 'Incidents';
      valueField = null;
  }

  const pipeline = [
    { $match: match || (range ? { [dateField]: range } : {}) },
    {
      $group: {
        _id: buildTimeGroup(granularity, dateField),
        value: valueField ? { $sum: `$${valueField}` } : { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ];

  const data = await collection.aggregate(pipeline);

  return {
    metric,
    granularity,
    series: data.map((item) => ({ period: item._id, value: item.value })),
    generatedAt: new Date(),
    filters: query,
  };
};

const getComparisonReport = async (query) => {
  const metric = query.metric || 'incidents';
  if (!query.from || !query.to) {
    throw new ServiceError('Comparison report requires `from` and `to` query parameters', 400);
  }

  const from = new Date(query.from);
  const to = new Date(query.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ServiceError('Invalid comparison date range', 400);
  }

  const rangeInMs = to.getTime() - from.getTime();
  const previousTo = new Date(from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - rangeInMs);

  const currentSeries = await getTimeSeriesReport({ ...query, from, to });
  const previousSeries = await getTimeSeriesReport({ ...query, from: previousFrom.toISOString(), to: previousTo.toISOString() });

  const sumValue = (series) => series.series.reduce((acc, item) => acc + Number(item.value || 0), 0);

  const currentTotal = sumValue(currentSeries);
  const previousTotal = sumValue(previousSeries);
  const variance = previousTotal ? (currentTotal - previousTotal) / previousTotal : null;

  return {
    metric,
    currentPeriod: { from: query.from, to: query.to, total: currentTotal },
    previousPeriod: { from: previousFrom.toISOString(), to: previousTo.toISOString(), total: previousTotal },
    variance,
    currentSeries: currentSeries.series,
    previousSeries: previousSeries.series,
    generatedAt: new Date(),
    filters: query,
  };
};

const buildCsv = (rows) => {
  const escapeValue = (value) => {
    if (value === undefined || value === null) return '';
    const text = String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  return rows.map((row) => row.map(escapeValue).join(',')).join('\n');
};

const exportReport = async (query) => {
  const type = query.type || query.reportType;
  if (!type) throw new ServiceError('Missing report type for export', 400);

  let rows = [];
  let headers = [];
  let fileName = `report-${type}-${Date.now()}.csv`;

  if (type === 'incidents') {
    const { incidents } = await getIncidentReport(query);
    headers = ['incidentId', 'residentName', 'incidentType', 'severity', 'status', 'incidentAt', 'location', 'description'];
    rows = incidents.map((item) => [
      item._id.toString(),
      item.residentId?.fullName || '',
      item.incidentType,
      item.severity,
      item.status,
      item.incidentAt ? new Date(item.incidentAt).toISOString() : '',
      item.location || '',
      item.description || '',
    ]);
  } else if (type === 'resident-count') {
    const report = await getResidentCountReport(query);
    headers = ['residencyStatus', 'count'];
    rows = report.statuses.map((item) => [item.residencyStatus, item.count]);
  } else if (type === 'financial') {
    const report = await getFinancialReport(query);
    headers = ['metric', 'value'];
    rows = [
      ['totalInvoices', report.invoiceSummary.totalInvoices],
      ['invoiceAmount', report.invoiceSummary.totalAmount],
      ['outstandingAmount', report.invoiceSummary.outstandingAmount],
      ['overdueInvoices', report.invoiceSummary.overdueInvoices],
      ['totalPayments', report.paymentSummary.totalPayments],
      ['paymentAmount', report.paymentSummary.totalAmount],
    ];
  } else if (type === 'compare') {
    const report = await getComparisonReport(query);
    headers = ['period', 'currentPeriodValue', 'previousPeriodValue'];
    const previousMap = new Map(report.previousSeries.map((item) => [item.period, item.value]));
    rows = report.currentSeries.map((item) => [
      item.period,
      item.value,
      previousMap.get(item.period) ?? 0,
    ]);
  } else {
    const report = await getTimeSeriesReport({ ...query, metric: type });
    headers = ['period', 'value'];
    rows = report.series.map((item) => [item.period, item.value]);
  }

  const csv = buildCsv([headers, ...rows]);
  return { csv, fileName };
};

const saveReportHistory = async (user, payload) => {
  if (!payload.reportType) throw new ServiceError('reportType is required', 400);
  if (!payload.title) throw new ServiceError('title is required', 400);

  const snapshot = new ReportSnapshot({
    reportType: payload.reportType,
    generatedByUserId: user._id,
    title: payload.title,
    filters: payload.filters || {},
    periodStart: payload.periodStart ? new Date(payload.periodStart) : undefined,
    periodEnd: payload.periodEnd ? new Date(payload.periodEnd) : undefined,
    summaryMetrics: payload.summaryMetrics || {},
    chartData: payload.chartData || {},
    exportedFileUrl: payload.exportedFileUrl || undefined,
  });
  await snapshot.save();
  return snapshot;
};

const listReportHistory = async (query) => {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.reportType) filter.reportType = query.reportType;
  if (query.generatedByUserId) filter.generatedByUserId = query.generatedByUserId;

  const [items, total] = await Promise.all([
    ReportSnapshot.find(filter)
      .sort({ generatedAt: -1 })
      .skip(skip)
      .limit(limit),
    ReportSnapshot.countDocuments(filter),
  ]);

  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    items,
  };
};

module.exports = {
  getResidentCountReport,
  getSummaryReport,
  getHealthStatusReport,
  getIncidentReport,
  getCareActivityReport,
  getFinancialReport,
  getTimeSeriesReport,
  getComparisonReport,
  exportReport,
  saveReportHistory,
  listReportHistory,
};
