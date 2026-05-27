require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/db');
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./config/swagger");
// import all models through index to ensure schemas are registered
const models = require('./models');

const app = express();

app.use(morgan('dev'));
app.use(express.json());
app.use(cookieParser());

// Swagger docs setup
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec)
);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/shift-templates', require('./routes/shiftTemplates'));
app.use('/api/shifts', require('./routes/shifts'));
app.use('/api/facilities', require('./routes/facilities'));
app.use('/api/residents', require('./routes/residents'));
app.use('/api/leave-requests', require('./routes/leaveRequests'));
app.use('/api/care-appointments', require('./routes/careAppointments'));
app.use('/api/care-notes', require('./routes/careNotes'));
app.use('/api/care-tasks', require('./routes/careTasks'));
app.use('/api/family', require('./routes/familyPortal'));

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

    const { startReadinessSyncJob } = require('./jobs/readinessSyncJob');
    startReadinessSyncJob();
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
