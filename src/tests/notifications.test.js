const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const { connectDB, disconnectDB } = require('../config/db');
const env = require('../config/env');
const User = require('../models/User');
const Notification = require('../models/Notification');

jest.setTimeout(25000);

describe('AI CareerOS - Phase 7 Notification Center Tests', () => {
  let userA;
  let userB;
  let tokenA;
  let tokenB;
  let notifA1;
  let notifA2;

  beforeAll(async () => {
    await connectDB();
    const timestamp = Date.now();

    userA = await User.create({
      email: `notif-user-a-${timestamp}@test.com`,
      passwordHash: '$2b$12$dummyhashfornotifs1234567890',
      role: 'candidate',
      status: 'active',
    });

    tokenA = jwt.sign(
      { id: userA._id.toString(), role: 'candidate', email: userA.email },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    userB = await User.create({
      email: `notif-user-b-${timestamp}@test.com`,
      passwordHash: '$2b$12$dummyhashfornotifs1234567890',
      role: 'candidate',
      status: 'active',
    });

    tokenB = jwt.sign(
      { id: userB._id.toString(), role: 'candidate', email: userB.email },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Create 2 notifications for User A (1 unread, 1 read)
    notifA1 = await Notification.create({
      userId: userA._id,
      type: 'job_match',
      title: 'Top Match Role',
      body: 'Found a 92% match role for your profile.',
      link: '/app/jobs',
      readAt: null,
    });

    notifA2 = await Notification.create({
      userId: userA._id,
      type: 'task_reminder',
      title: 'Roadmap Milestone Due',
      body: 'Day 3 milestone task is due today.',
      link: '/app/tasks',
      readAt: new Date(),
    });
  });

  afterAll(async () => {
    if (userA) {
      await User.deleteMany({ _id: { $in: [userA._id, userB._id] } });
      await Notification.deleteMany({ userId: { $in: [userA._id, userB._id] } });
    }
    await disconnectDB();
  });

  it('GET /api/notifications returns user notifications with unread count', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Cookie', [`token=${tokenA}`]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.notifications.length).toBe(2);
    expect(res.body.data.unreadCount).toBe(1);
  });

  it('GET /api/notifications?unreadOnly=true filters for unread items', async () => {
    const res = await request(app)
      .get('/api/notifications?unreadOnly=true')
      .set('Cookie', [`token=${tokenA}`]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.notifications.length).toBe(1);
    expect(res.body.data.notifications[0]._id.toString()).toBe(notifA1._id.toString());
  });

  it('GET /api/notifications/unread-count returns integer count for navbar badge', async () => {
    const res = await request(app)
      .get('/api/notifications/unread-count')
      .set('Cookie', [`token=${tokenA}`]);

    expect(res.status).toBe(200);
    expect(res.body.data.unreadCount).toBe(1);
  });

  it('PATCH /api/notifications/:id/read marks unread notification as read', async () => {
    const res = await request(app)
      .patch(`/api/notifications/${notifA1._id}/read`)
      .set('Cookie', [`token=${tokenA}`]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.notification.readAt).not.toBeNull();

    const countRes = await request(app)
      .get('/api/notifications/unread-count')
      .set('Cookie', [`token=${tokenA}`]);
    expect(countRes.body.data.unreadCount).toBe(0);
  });

  it('Strict IDOR Isolation: User B cannot mark User A notification as read', async () => {
    const res = await request(app)
      .patch(`/api/notifications/${notifA2._id}/read`)
      .set('Cookie', [`token=${tokenB}`]);

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('Notification not found or access denied');
  });

  it('POST /api/notifications/read-all marks all unread notifications as read', async () => {
    // Add two unread notifications for User B
    await Notification.create([
      {
        userId: userB._id,
        type: 'system_alert',
        title: 'Alert 1',
        body: 'Body 1',
      },
      {
        userId: userB._id,
        type: 'system_alert',
        title: 'Alert 2',
        body: 'Body 2',
      },
    ]);

    const countBefore = await request(app)
      .get('/api/notifications/unread-count')
      .set('Cookie', [`token=${tokenB}`]);
    expect(countBefore.body.data.unreadCount).toBe(2);

    const res = await request(app)
      .post('/api/notifications/read-all')
      .set('Cookie', [`token=${tokenB}`]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.modifiedCount).toBe(2);

    const countAfter = await request(app)
      .get('/api/notifications/unread-count')
      .set('Cookie', [`token=${tokenB}`]);
    expect(countAfter.body.data.unreadCount).toBe(0);
  });
});

