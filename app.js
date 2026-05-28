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

const app = express();

// Configure CORS to allow requests from frontend
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
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
app.use('/api/care-appointments', require('./routes/careAppointments'));
app.use('/api/care-notes', require('./routes/careNotes'));
app.use('/api/incidents', require('./routes/incidents'));
app.use('/api/family', require('./routes/familyIndex'));
app.use('/api/admin', require('./routes/adminIndex'));
app.use('/api/residents', require('./routes/residents'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/shifts', require('./routes/shifts'));
app.use('/api/shift-templates', require('./routes/shiftTemplates'));
app.use('/api/leave-requests', require('./routes/leaveRequests'));
app.use('/api/medical/admission-requests', require('./routes/medicalAdmissions'));
app.use('/api/medical/service-packages', require('./routes/medicalServicePackages'));
app.use('/api/prescriptions', require('./routes/prescriptionRoutes'));
app.use('/api/medications', require('./routes/scheduleRoutes'));
app.use('/api/pharmacy', require('./routes/pharmacy'));


// connect DB and create collections
const initDB = async () => {
  try {
    await connectDB();

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
  res.status(500).json({ message: 'Internal server error' });
});
module.exports = app;
