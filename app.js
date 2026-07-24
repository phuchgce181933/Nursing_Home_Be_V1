if (process.env.NODE_ENV === 'local') {
  require('dotenv').config({ path: '.env.local', override: false });
}
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const connectDB = require('./config/db');
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./config/swagger");
const { startReminderScheduler } = require('./services/reminderSchedulerService');
// import all models through index to ensure schemas are registered
const models = require('./models');
const { initMedicationJobs } = require('./jobs/medicationReminderJob');
const auditLogger = require('./middleware/auditLogger');

const app = express();

// Configure CORS to allow requests from frontend. CORS_ORIGINS is a comma-separated list of
// additional allowed origins (e.g. the deployed web app's domain) layered on top of the local
// dev defaults, so a single deploy config doesn't have to hardcode/replace this list in code.
const extraOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:8081', ...extraOrigins],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(morgan('dev'));
app.use(
  bodyParser.json({
    limit: '1mb',
    type: (req) => (req.headers['content-type'] || '').toLowerCase().includes('json'),
  })
);
app.use(
  bodyParser.text({
    limit: '1mb',
    type: (req) => {
      if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return false;
      const ct = (req.headers['content-type'] || '').toLowerCase();
      if (ct.includes('text/plain')) return true;
      if (!ct) return true;
      return false;
    },
  })
);
app.use(require('./middleware/parseJsonBody'));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(auditLogger);
// app.use((req, res, next) => {
//   const _json = res.json.bind(res);
//   res.json = (body) => _json(convertDates(JSON.parse(JSON.stringify(body))));
//   next();
// });

// Swagger docs setup
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec)
);

// Routes
app.use('/api/auth', require('./routes/auth'));
// Must be registered before /api/staff so /care-tasks is not handled by GET /api/staff/:id
app.use('/api/staff/care-tasks', require('./routes/careTasks'));
app.use('/api/staff/care-schedules', require('./routes/careSchedules'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/shift-templates', require('./routes/shiftTemplates'));
app.use('/api/shifts', require('./routes/shifts'));
app.use('/api/facilities', require('./routes/facilities'));
app.use('/api/residents', require('./routes/residents'));
app.use('/api/leave-requests', require('./routes/leaveRequests'));
app.use('/api/care-appointments', require('./routes/careAppointments'));
app.use('/api/care-notes', require('./routes/careNotes'));
app.use('/api/resident-visits', require('./routes/staffResidentVisits'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/family', require('./routes/familyIndex'));
app.use('/api/admin', require('./routes/adminIndex'));
// expose conversations router at root path as well for legacy or direct calls
app.use('/conversations', require('./routes/conversations'));
// canonical mount: works for every authenticated role (fixes doctor/nurse 404s that
// happened when the frontend derived the API prefix from the current URL segment)
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/payos', require('./routes/payos'));
app.use('/payos', require('./routes/payos'));
app.use('/api/medical/admission-requests', require('./routes/medicalAdmissions'));


app.use('/api/nurse/meal-plans', require('./routes/mealPlans'));
app.use('/api/nurse/special-diets', require('./routes/specialDiets'));
app.use('/api/nurse/meal-time-schedules', require('./routes/mealTimeSchedules'));
app.use('/api/nurse/nutrition-reports', require('./routes/nutritionReports'));
app.use('/api/caregiver/meal-intake-notes', require('./routes/caregiverMealIntakeNotes'));
app.use('/api/caregiver/residents', require('./routes/caregiverResidents'));
app.use('/api/caregiver/care-tasks', require('./routes/caregiverCareTasks'));
app.use('/api/caregiver/hygiene-activities', require('./routes/caregiverHygieneActivities'));
app.use('/api/caregiver/daily-behaviors', require('./routes/caregiverDailyBehaviors'));
app.use('/api/caregiver/diet-plans', require('./routes/caregiverDietPlans'));
app.use('/api/caregiver/rehabilitation-schedules', require('./routes/caregiverRehabilitationSchedules'));
app.use('/api/staff/assigned-residents', require('./routes/staffAssignedResidents'));

app.use('/api/prescriptions', require('./routes/prescriptionRoutes'));
app.use('/api/medications', require('./routes/scheduleRoutes'));

app.use('/api/incidents', require('./routes/incidents'));
app.use('/api/medical', require('./routes/medicalServicePackages'));
app.use('/api/pharmacy', require('./routes/pharmacy'));
// Clinical services and billing
app.use('/api/clinical/services', require('./routes/clinicalServices'));
app.use('/api/clinical/charges', require('./routes/medicalCharges'));
app.use('/api/clinical/invoices', require('./routes/invoices'));

// connect DB and create collections
const initDB = async () => {
  try {
    await connectDB();

    const { ensureStaffProfilesForAssignableUsers } = require('./services/staffProfileBootstrap');
    const profileBootstrap = await ensureStaffProfilesForAssignableUsers();
    if (profileBootstrap.created) {
      console.log(`Staff profile bootstrap: ${profileBootstrap.created} profile(s) created.`);
    }

    const { ensureDefaultShiftTemplates } = require('./services/defaultShiftBootstrap');
    await ensureDefaultShiftTemplates();

    for (let key in models) {
      const model = models[key];
      try {
        await model.createCollection();
        console.log('Created:', model.collection.name);
      } catch (err) {
        console.log('Exists:', model.collection.name);
      }
    }

    console.log('All collections initialized');

    const { startReadinessSyncJob } = require('./jobs/readinessSyncJob');
    startReadinessSyncJob();
    const { startLeaveRequestAutoRejectJob } = require('./jobs/leaveRequestAutoRejectJob');
    startLeaveRequestAutoRejectJob();
    const { startCareTaskAutoSkipJob } = require('./jobs/careTaskAutoSkipJob');
    startCareTaskAutoSkipJob();
    const { startShiftAutoCancelJob } = require('./jobs/shiftAutoCancelJob');
    startShiftAutoCancelJob();
    startReminderScheduler();
    initMedicationJobs();
  } catch (err) {
    console.error(err);
  }
};

initDB();

app.get('/', (req, res) => {
  res.json({ message: 'Nursing Home API running' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    message: err.message || 'Internal server error',
    errorCode: err.errorCode,
  });
});
module.exports = app;
