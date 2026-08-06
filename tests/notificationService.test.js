const test = require('node:test');
const assert = require('node:assert/strict');

const { buildListFilter, buildSoftDeleteUpdate } = require('../services/notificationService');

test('buildListFilter excludes soft-deleted notifications by default', () => {
  const filter = buildListFilter('user-1', { category: 'activity' });

  assert.deepEqual(filter, {
    recipientUserId: 'user-1',
    isDeleted: false,
    category: 'activity',
  });
});

test('buildSoftDeleteUpdate marks a notification as deleted without removing it from the database', () => {
  const update = buildSoftDeleteUpdate();

  assert.equal(update.$set.isDeleted, true);
  assert.equal(update.$set.deletedAt instanceof Date, true);
});
