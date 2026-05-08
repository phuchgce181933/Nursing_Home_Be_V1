const express = require('express');
const connectDB = require('./config/db');

//  import tất cả model qua index
const models = require('./models');

const app = express();

app.use(express.json());

//  connect DB + tạo collection
const initDB = async () => {
  try {
    await connectDB();

    //  tự tạo tất cả collection từ models
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
  } catch (err) {
    console.error(err);
  }
};

initDB();

app.get('/', (req, res) => {
  res.send('API running...');
});

module.exports = app;