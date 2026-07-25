const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHealthMonitoringNotificationPayload } = require('../services/medicalRecordService');

test('buildHealthMonitoringNotificationPayload includes abnormal health and service context', () => {
  const payload = buildHealthMonitoringNotificationPayload({
    resident: { _id: 'resident-1', fullName: 'Nguyễn Văn A' },
    record: {
      _id: 'record-1',
      abnormalFlag: true,
      selectedServices: [{ serviceName: 'Xét nghiệm máu' }],
      summary: 'Tình trạng cải thiện',
    },
    user: { fullName: 'BS. Lan' },
  });

  assert.equal(payload.category, 'health');
  assert.match(payload.title, /sức khỏe/i);
  assert.match(payload.content, /bất thường/i);
  assert.match(payload.content, /Xét nghiệm máu/i);
  assert.match(payload.content, /Tình trạng cải thiện/i);
});
