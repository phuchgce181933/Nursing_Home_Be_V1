const ServiceError = require('../services/serviceError');
const { NON_ASSIGNABLE_ROLES, OPERATIONAL_ASSIGNABLE_ROLES } = require('../models/enums');

const isPrivilegedRole = (role) => NON_ASSIGNABLE_ROLES.includes(role);

const isManagerActor = (actor) => actor?.role === 'manager';

/** Roles a manager may assign when creating or updating staff accounts. */
const getCreatableRolesForActor = (actor) =>
  isManagerActor(actor) ? [...OPERATIONAL_ASSIGNABLE_ROLES] : null;

const assertActorMayCreateRole = (actor, targetRole) => {
  if (!isManagerActor(actor)) return;
  if (isPrivilegedRole(targetRole)) {
    throw new ServiceError('Managers cannot create admin or manager accounts', 403);
  }
  if (!OPERATIONAL_ASSIGNABLE_ROLES.includes(targetRole)) {
    throw new ServiceError(
      `Managers can only create accounts with role: ${OPERATIONAL_ASSIGNABLE_ROLES.join(', ')}`,
      400
    );
  }
};

const assertActorMayAssignRole = (actor, targetRole) => {
  if (!targetRole || !isManagerActor(actor)) return;
  if (isPrivilegedRole(targetRole)) {
    throw new ServiceError('Managers cannot assign admin or manager roles', 403);
  }
  if (!OPERATIONAL_ASSIGNABLE_ROLES.includes(targetRole)) {
    throw new ServiceError(
      `Managers can only assign roles: ${OPERATIONAL_ASSIGNABLE_ROLES.join(', ')}`,
      400
    );
  }
};

const assertActorMayManageUser = (actor, targetUser) => {
  if (!targetUser || !isManagerActor(actor)) return;
  if (isPrivilegedRole(targetUser.role)) {
    throw new ServiceError('Managers cannot modify admin or manager accounts', 403);
  }
};

module.exports = {
  isPrivilegedRole,
  isManagerActor,
  getCreatableRolesForActor,
  assertActorMayCreateRole,
  assertActorMayAssignRole,
  assertActorMayManageUser,
  OPERATIONAL_ASSIGNABLE_ROLES,
};
