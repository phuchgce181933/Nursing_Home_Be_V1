const { NON_ASSIGNABLE_ROLES, OPERATIONAL_ASSIGNABLE_ROLES } = require('../models/enums');

const isPrivilegedRole = (role) => NON_ASSIGNABLE_ROLES.includes(role);

const isManagerActor = () => false;

const getCreatableRolesForActor = () => null;

const assertActorMayCreateRole = () => {};

const assertActorMayAssignRole = () => {};

const assertActorMayManageUser = () => {};

module.exports = {
  isPrivilegedRole,
  isManagerActor,
  getCreatableRolesForActor,
  assertActorMayCreateRole,
  assertActorMayAssignRole,
  assertActorMayManageUser,
  OPERATIONAL_ASSIGNABLE_ROLES,
};
