import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { UserModel } from '../models/user.model.js';
import { FieldModel } from '../models/field.model.js';
import { OrganisationModel } from '../models/organisation.model.js';
import { MembershipModel } from '../models/membership.model.js';
import { FarmerModel } from '../models/farmer.model.js';
import { RecommendationModel } from '../models/recommendation.model.js';
import { runOrganisationMigration } from '../services/migrate-organisations.js';
import { authService } from '../services/auth.service.js';

describe('Phase 24: Organisation Workspaces, Roles & RBAC', () => {
  let mongod: MongoMemoryServer;
  const app = createApp();

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create({
      binary: {
        version: '7.0.14',
      },
    });
    const uri = mongod.getUri();
    await mongoose.connect(uri);
    await FieldModel.syncIndexes();
    await FarmerModel.syncIndexes();
    await MembershipModel.syncIndexes();
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) {
      await mongod.stop();
    }
  }, 30000);

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await OrganisationModel.deleteMany({});
    await MembershipModel.deleteMany({});
    await FarmerModel.deleteMany({});
    await FieldModel.deleteMany({});
    await RecommendationModel.deleteMany({});
  });

  async function registerUser(email: string, name: string) {
    const res = await request(app).post('/auth/register').send({
      email,
      password: 'Password123!',
      name,
      language: 'en',
      areaUnit: 'acre',
    });
    return {
      token: res.body.data.accessToken as string,
      user: res.body.data.user,
    };
  }

  const samplePolygon = {
    type: 'Polygon',
    coordinates: [
      [
        [77.1, 28.6],
        [77.102, 28.6],
        [77.102, 28.602],
        [77.1, 28.602],
        [77.1, 28.6],
      ],
    ],
  };

  it('provisions personal organisation and admin membership on user registration', async () => {
    const userA = await registerUser('alice@example.com', 'Alice');

    // Fetch user organisations
    const orgsRes = await request(app)
      .get('/organisations')
      .set('Authorization', `Bearer ${userA.token}`);

    expect(orgsRes.status).toBe(200);
    expect(orgsRes.body.data.organisations).toHaveLength(1);
    expect(orgsRes.body.data.organisations[0].role).toBe('admin');
    expect(orgsRes.body.data.organisations[0].organisation.name).toBe("Alice's Farm");

    // Fetch farmers in personal org
    const orgId =
      orgsRes.body.data.organisations[0].organisation.id ||
      orgsRes.body.data.organisations[0].organisation._id;
    const farmersRes = await request(app)
      .get('/farmers')
      .set('Authorization', `Bearer ${userA.token}`)
      .set('x-org-id', orgId);

    expect(farmersRes.status).toBe(200);
    expect(farmersRes.body.data.farmers).toHaveLength(1);
    expect(farmersRes.body.data.farmers[0].name).toBe('Alice');
    expect(farmersRes.body.data.farmers[0].status).toBe('active');
  });

  it('enforces RBAC on organisation member management (admin only, sole admin protection)', async () => {
    const admin = await registerUser('admin@coop.com', 'Admin User');
    const agent = await registerUser('agent@coop.com', 'Agent User');

    // Admin creates new Organisation
    const createOrgRes = await request(app)
      .post('/organisations')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'Punjab Agro Cooperative' });

    expect(createOrgRes.status).toBe(201);
    const orgId = createOrgRes.body.data.organisation.id || createOrgRes.body.data.organisation._id;

    // Admin adds Agent as member with role 'agent'
    const addMemberRes = await request(app)
      .post(`/organisations/${orgId}/members`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: 'agent@coop.com', role: 'agent' });

    expect(addMemberRes.status).toBe(201);
    expect(addMemberRes.body.data.member.role).toBe('agent');

    // Agent attempts to add members -> 403 Forbidden
    const agentAddRes = await request(app)
      .post(`/organisations/${orgId}/members`)
      .set('Authorization', `Bearer ${agent.token}`)
      .send({ email: 'other@coop.com', role: 'agent' });

    expect(agentAddRes.status).toBe(403);

    // Sole admin cannot be demoted or removed
    const demoteAdminRes = await request(app)
      .patch(`/organisations/${orgId}/members/${admin.user.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ role: 'agent' });

    expect(demoteAdminRes.status).toBe(400);
    expect(demoteAdminRes.body.code).toBe('CANNOT_DEMOTE_SOLE_ADMIN');
  });

  it("agent cannot see another agent's farmers when restricted; admin sees all in their organisation", async () => {
    const admin = await registerUser('admin@org.com', 'Org Admin');
    const agent1 = await registerUser('agent1@org.com', 'Agent One');
    const agent2 = await registerUser('agent2@org.com', 'Agent Two');

    // Setup organisation
    const orgRes = await request(app)
      .post('/organisations')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'Regional Cooperative' });
    const orgId = orgRes.body.data.organisation.id || orgRes.body.data.organisation._id;

    // Add Agent 1 and Agent 2 to org
    await request(app)
      .post(`/organisations/${orgId}/members`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: 'agent1@org.com', role: 'agent' });

    await request(app)
      .post(`/organisations/${orgId}/members`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: 'agent2@org.com', role: 'agent' });

    // Admin creates Farmer 1 assigned to Agent 1
    const farmer1Res = await request(app)
      .post('/farmers')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-org-id', orgId)
      .send({
        name: 'Farmer One (Agent 1)',
        phone: '+919876543210',
        village: 'Kharar',
        assignedAgentId: agent1.user.id,
      });
    expect(farmer1Res.status).toBe(201);
    const farmer1Id = farmer1Res.body.data.farmer.id;

    // Admin creates Farmer 2 assigned to Agent 2
    const farmer2Res = await request(app)
      .post('/farmers')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-org-id', orgId)
      .send({
        name: 'Farmer Two (Agent 2)',
        phone: '+919876543211',
        village: 'Morinda',
        assignedAgentId: agent2.user.id,
      });
    expect(farmer2Res.status).toBe(201);
    const farmer2Id = farmer2Res.body.data.farmer.id;

    // Admin creates Farmer 3 unassigned
    const farmer3Res = await request(app)
      .post('/farmers')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-org-id', orgId)
      .send({
        name: 'Farmer Three (Unassigned)',
        village: 'Ropar',
      });
    expect(farmer3Res.status).toBe(201);

    // 1. Agent 1 lists farmers -> sees ONLY Farmer 1
    const agent1List = await request(app)
      .get('/farmers')
      .set('Authorization', `Bearer ${agent1.token}`)
      .set('x-org-id', orgId);

    expect(agent1List.status).toBe(200);
    expect(agent1List.body.data.farmers).toHaveLength(1);
    expect(agent1List.body.data.farmers[0].name).toBe('Farmer One (Agent 1)');

    // 2. Agent 2 lists farmers -> sees ONLY Farmer 2
    const agent2List = await request(app)
      .get('/farmers')
      .set('Authorization', `Bearer ${agent2.token}`)
      .set('x-org-id', orgId);

    expect(agent2List.status).toBe(200);
    expect(agent2List.body.data.farmers).toHaveLength(1);
    expect(agent2List.body.data.farmers[0].name).toBe('Farmer Two (Agent 2)');

    // 3. Admin lists farmers -> sees ALL farmers (Farmer 1, Farmer 2, Farmer 3)
    const adminList = await request(app)
      .get('/farmers')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-org-id', orgId);

    expect(adminList.status).toBe(200);
    expect(adminList.body.data.farmers.length).toBeGreaterThanOrEqual(3);

    // 4. Agent 1 tries to access Farmer 2 -> 403 Forbidden
    const agent1AccessFarmer2 = await request(app)
      .get(`/farmers/${farmer2Id}`)
      .set('Authorization', `Bearer ${agent1.token}`)
      .set('x-org-id', orgId);

    expect(agent1AccessFarmer2.status).toBe(403);

    // 5. Agent 1 tries to update Farmer 2 -> 403 Forbidden
    const agent1UpdateFarmer2 = await request(app)
      .patch(`/farmers/${farmer2Id}`)
      .set('Authorization', `Bearer ${agent1.token}`)
      .set('x-org-id', orgId)
      .send({ village: 'Hacked' });

    expect(agent1UpdateFarmer2.status).toBe(403);

    // 6. Agent 1 tries to delete Farmer 1 -> 403 Forbidden (admin only)
    const agentDeleteRes = await request(app)
      .delete(`/farmers/${farmer1Id}`)
      .set('Authorization', `Bearer ${agent1.token}`)
      .set('x-org-id', orgId);

    expect(agentDeleteRes.status).toBe(403);

    // 7. Admin deletes Farmer 1 -> 200 OK (soft delete)
    const adminDeleteRes = await request(app)
      .delete(`/farmers/${farmer1Id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-org-id', orgId);

    expect(adminDeleteRes.status).toBe(200);
    const dbFarmer1 = await FarmerModel.findById(farmer1Id);
    expect(dbFarmer1).toBeNull();
  });

  it('agent sees and manages only fields belonging to their assigned farmers; admin sees all fields in org', async () => {
    const admin = await registerUser('admin@farms.com', 'Admin F');
    const agent1 = await registerUser('agent1@farms.com', 'Agent F1');
    const agent2 = await registerUser('agent2@farms.com', 'Agent F2');

    // Create org and members
    const orgRes = await request(app)
      .post('/organisations')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'Farms Ltd' });
    const orgId = orgRes.body.data.organisation.id || orgRes.body.data.organisation._id;

    await request(app)
      .post(`/organisations/${orgId}/members`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: 'agent1@farms.com', role: 'agent' });
    await request(app)
      .post(`/organisations/${orgId}/members`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: 'agent2@farms.com', role: 'agent' });

    // Create farmers
    const f1 = await request(app)
      .post('/farmers')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-org-id', orgId)
      .send({ name: 'Farmer 1', assignedAgentId: agent1.user.id });
    const f2 = await request(app)
      .post('/farmers')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-org-id', orgId)
      .send({ name: 'Farmer 2', assignedAgentId: agent2.user.id });

    // Agent 1 creates field under Farmer 1
    const field1Res = await request(app)
      .post('/fields')
      .set('Authorization', `Bearer ${agent1.token}`)
      .set('x-org-id', orgId)
      .send({
        name: 'Wheat North Field',
        cropKey: 'wheat',
        sowingDate: '2026-11-01',
        soilType: 'loam',
        method: 'drip',
        baseline: { everyDays: 3, depthMm: 25 },
        farmerId: f1.body.data.farmer.id,
        geometry: samplePolygon,
      });
    expect(field1Res.status).toBe(201);
    const field1Id = field1Res.body.data.field.id;

    // Agent 2 creates field under Farmer 2
    const field2Res = await request(app)
      .post('/fields')
      .set('Authorization', `Bearer ${agent2.token}`)
      .set('x-org-id', orgId)
      .send({
        name: 'Cotton South Field',
        cropKey: 'cotton',
        sowingDate: '2026-11-01',
        soilType: 'sandy',
        method: 'flood',
        baseline: { everyDays: 4, depthMm: 30 },
        farmerId: f2.body.data.farmer.id,
        geometry: samplePolygon,
      });
    expect(field2Res.status).toBe(201);
    const field2Id = field2Res.body.data.field.id;

    // 1. Agent 1 lists fields -> sees ONLY Field 1
    const agent1Fields = await request(app)
      .get('/fields')
      .set('Authorization', `Bearer ${agent1.token}`)
      .set('x-org-id', orgId);

    expect(agent1Fields.status).toBe(200);
    expect(agent1Fields.body.data.fields).toHaveLength(1);
    expect(agent1Fields.body.data.fields[0].id).toBe(field1Id);

    // 2. Agent 2 lists fields -> sees ONLY Field 2
    const agent2Fields = await request(app)
      .get('/fields')
      .set('Authorization', `Bearer ${agent2.token}`)
      .set('x-org-id', orgId);

    expect(agent2Fields.status).toBe(200);
    expect(agent2Fields.body.data.fields).toHaveLength(1);
    expect(agent2Fields.body.data.fields[0].id).toBe(field2Id);

    // 3. Admin lists fields -> sees BOTH Field 1 and Field 2
    const adminFields = await request(app)
      .get('/fields')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-org-id', orgId);

    expect(adminFields.status).toBe(200);
    expect(adminFields.body.data.fields).toHaveLength(2);

    // 4. Agent 1 cannot read Field 2
    const agent1GetField2 = await request(app)
      .get(`/fields/${field2Id}`)
      .set('Authorization', `Bearer ${agent1.token}`)
      .set('x-org-id', orgId);

    expect(agent1GetField2.status).toBe(403);

    // 5. Agent 1 cannot update Field 2
    const agent1UpdateField2 = await request(app)
      .patch(`/fields/${field2Id}`)
      .set('Authorization', `Bearer ${agent1.token}`)
      .set('x-org-id', orgId)
      .send({ name: 'Hacked Field', version: 1 });

    expect(agent1UpdateField2.status).toBe(403);

    // 6. Agent 1 cannot delete Field 2
    const agent1DeleteField2 = await request(app)
      .delete(`/fields/${field2Id}`)
      .set('Authorization', `Bearer ${agent1.token}`)
      .set('x-org-id', orgId);

    expect(agent1DeleteField2.status).toBe(403);

    // 7. Agent 1 cannot read Field 2 recommendations
    const agent1RecsField2 = await request(app)
      .get(`/fields/${field2Id}/recommendations`)
      .set('Authorization', `Bearer ${agent1.token}`)
      .set('x-org-id', orgId);

    expect(agent1RecsField2.status).toBe(403);
  });

  it('acceptance: two organisations with different agents cannot see each others data in any API call', async () => {
    // Org A setup
    const adminA = await registerUser('adminA@orga.com', 'Admin A');
    const agentA = await registerUser('agentA@orga.com', 'Agent A');
    const orgARes = await request(app)
      .post('/organisations')
      .set('Authorization', `Bearer ${adminA.token}`)
      .send({ name: 'Organisation A' });
    const orgAId = orgARes.body.data.organisation.id || orgARes.body.data.organisation._id;
    await request(app)
      .post(`/organisations/${orgAId}/members`)
      .set('Authorization', `Bearer ${adminA.token}`)
      .send({ email: 'agentA@orga.com', role: 'agent' });

    const farmerA = await request(app)
      .post('/farmers')
      .set('Authorization', `Bearer ${adminA.token}`)
      .set('x-org-id', orgAId)
      .send({ name: 'Farmer Alpha', assignedAgentId: agentA.user.id });
    const fieldA = await request(app)
      .post('/fields')
      .set('Authorization', `Bearer ${agentA.token}`)
      .set('x-org-id', orgAId)
      .send({
        name: 'Field Alpha',
        cropKey: 'wheat',
        sowingDate: '2026-11-01',
        soilType: 'clay',
        method: 'drip',
        baseline: { everyDays: 3, depthMm: 20 },
        farmerId: farmerA.body.data.farmer.id,
        geometry: samplePolygon,
      });

    // Org B setup
    const adminB = await registerUser('adminB@orgb.com', 'Admin B');
    const agentB = await registerUser('agentB@orgb.com', 'Agent B');
    const orgBRes = await request(app)
      .post('/organisations')
      .set('Authorization', `Bearer ${adminB.token}`)
      .send({ name: 'Organisation B' });
    const orgBId = orgBRes.body.data.organisation.id || orgBRes.body.data.organisation._id;
    await request(app)
      .post(`/organisations/${orgBId}/members`)
      .set('Authorization', `Bearer ${adminB.token}`)
      .send({ email: 'agentB@orgb.com', role: 'agent' });

    const farmerB = await request(app)
      .post('/farmers')
      .set('Authorization', `Bearer ${adminB.token}`)
      .set('x-org-id', orgBId)
      .send({ name: 'Farmer Beta', assignedAgentId: agentB.user.id });

    // 1. Agent B tries to list Org A's farmers with x-org-id: orgAId -> 403 Forbidden
    const crossOrgFarmers = await request(app)
      .get('/farmers')
      .set('Authorization', `Bearer ${agentB.token}`)
      .set('x-org-id', orgAId);
    expect(crossOrgFarmers.status).toBe(403);

    // 2. Agent B tries to access Farmer Alpha directly -> 404 (or 403)
    const crossOrgFarmerAccess = await request(app)
      .get(`/farmers/${farmerA.body.data.farmer.id}`)
      .set('Authorization', `Bearer ${agentB.token}`)
      .set('x-org-id', orgBId);
    expect([403, 404]).toContain(crossOrgFarmerAccess.status);

    // 3. Agent B tries to read Field Alpha -> 404 (not in org B)
    const crossOrgFieldAccess = await request(app)
      .get(`/fields/${fieldA.body.data.field.id}`)
      .set('Authorization', `Bearer ${agentB.token}`)
      .set('x-org-id', orgBId);
    expect([403, 404]).toContain(crossOrgFieldAccess.status);

    // 4. Admin B tries to read Field Alpha -> 404
    const adminBCrossField = await request(app)
      .get(`/fields/${fieldA.body.data.field.id}`)
      .set('Authorization', `Bearer ${adminB.token}`)
      .set('x-org-id', orgBId);
    expect([403, 404]).toContain(adminBCrossField.status);

    // 5. Agent B tries to access Org A members -> 403 Forbidden
    const crossOrgMembers = await request(app)
      .get(`/organisations/${orgAId}/members`)
      .set('Authorization', `Bearer ${agentB.token}`);
    expect(crossOrgMembers.status).toBe(403);

    // 6. Agent A cannot access Farmer Beta in Org B
    const crossOrgFarmerBAccess = await request(app)
      .get(`/farmers/${farmerB.body.data.farmer.id}`)
      .set('Authorization', `Bearer ${agentA.token}`)
      .set('x-org-id', orgAId);
    expect([403, 404]).toContain(crossOrgFarmerBAccess.status);
  });

  it('migration run twice changes nothing (idempotent); old routes still return the same data for existing users', async () => {
    // 1. Setup legacy user with fields directly in DB before migration
    const legacyUser = await UserModel.create({
      email: 'legacy.farmer@example.com',
      passwordHash: 'dummyhash',
      name: 'Ramesh Patel',
      language: 'hi',
      areaUnit: 'acre',
    });

    // Create 2 legacy fields with no orgId and no farmerId
    const legacyField1 = await FieldModel.create({
      userId: legacyUser._id,
      name: 'Old Field 1',
      locationMode: 'polygon',
      geometry: samplePolygon,
      centroid: { type: 'Point', coordinates: [77.101, 28.601] },
      areaHa: 1.5,
      cropKey: 'wheat',
      sowingDate: new Date('2026-11-01'),
      soilType: 'loam',
      method: 'drip',
      baseline: { everyDays: 3, depthMm: 20 },
      waterMode: 'irrigated',
      hasProtectiveWater: false,
      version: 1,
    });

    const legacyField2 = await FieldModel.create({
      userId: legacyUser._id,
      name: 'Old Field 2',
      locationMode: 'polygon',
      geometry: samplePolygon,
      centroid: { type: 'Point', coordinates: [77.101, 28.601] },
      areaHa: 2.0,
      cropKey: 'rice',
      sowingDate: new Date('2026-11-01'),
      soilType: 'clay',
      method: 'flood',
      baseline: { everyDays: 2, depthMm: 30 },
      waterMode: 'irrigated',
      hasProtectiveWater: false,
      version: 1,
    });

    // 2. Test dry-run migration
    const dryRunRes = await runOrganisationMigration({ dryRun: true, silent: true });
    expect(dryRunRes.dryRun).toBe(true);
    expect(dryRunRes.usersScanned).toBeGreaterThanOrEqual(1);
    expect(dryRunRes.fieldsUpdated).toBeGreaterThanOrEqual(2);

    // Verify DB was NOT modified by dry-run
    const dbFieldAfterDryRun = await FieldModel.findById(legacyField1._id);
    expect(dbFieldAfterDryRun?.orgId).toBeFalsy();
    expect(dbFieldAfterDryRun?.farmerId).toBeFalsy();

    // 3. Run migration first time (committed)
    const run1 = await runOrganisationMigration({ dryRun: false, silent: true });
    expect(run1.dryRun).toBe(false);
    expect(run1.orgsCreated).toBeGreaterThanOrEqual(1);
    expect(run1.farmersCreated).toBeGreaterThanOrEqual(1);
    expect(run1.fieldsUpdated).toBeGreaterThanOrEqual(2);

    // Verify fields in DB have orgId and farmerId set
    const migratedField1 = await FieldModel.findById(legacyField1._id);
    const migratedField2 = await FieldModel.findById(legacyField2._id);
    expect(migratedField1?.orgId).toBeDefined();
    expect(migratedField1?.farmerId).toBeDefined();
    expect(migratedField2?.orgId).toEqual(migratedField1?.orgId);

    // 4. Run migration second time -> CHANGES NOTHING!
    const run2 = await runOrganisationMigration({ dryRun: false, silent: true });
    expect(run2.orgsCreated).toBe(0);
    expect(run2.membershipsCreated).toBe(0);
    expect(run2.farmersCreated).toBe(0);
    expect(run2.fieldsUpdated).toBe(0);
    expect(run2.errors).toBe(0);

    // 5. Old routes still return the same data for existing users
    // Authenticate as legacy user
    const token = authService.generateAccessToken(legacyUser._id.toString(), legacyUser.email);

    // Call legacy GET /fields without x-org-id header
    const oldFieldsRes = await request(app)
      .get('/fields')
      .set('Authorization', `Bearer ${token}`);

    expect(oldFieldsRes.status).toBe(200);
    expect(oldFieldsRes.body.data.fields.length).toBeGreaterThanOrEqual(2);

    // Call legacy GET /fields/:id without x-org-id header
    const oldFieldRes = await request(app)
      .get(`/fields/${legacyField1._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(oldFieldRes.status).toBe(200);
    expect(oldFieldRes.body.data.field.name).toBe('Old Field 1');
  });
});
