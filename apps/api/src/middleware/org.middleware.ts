import { Request, Response, NextFunction, RequestHandler } from 'express';
import { Types } from 'mongoose';
import { AppError } from '../errors/AppError.js';
import { OrganisationModel } from '../models/organisation.model.js';
import { MembershipModel, IMembershipDocument, OrganisationRole } from '../models/membership.model.js';
import { FarmerModel } from '../models/farmer.model.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      orgId?: Types.ObjectId;
      role?: OrganisationRole;
      membership?: IMembershipDocument;
    }
  }
}

/**
 * Ensures user has an active organisation context.
 * Resolves via `x-org-id` header or falls back to user's primary/first organisation.
 * If user has no organisation yet, creates their default personal organisation.
 */
export async function orgMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
    return;
  }

  const requestedOrgHeader =
    req.header('x-org-id') ||
    (req.params && typeof req.params.orgId === 'string' ? req.params.orgId : undefined) ||
    (typeof req.query.orgId === 'string' ? req.query.orgId : undefined);
  const requestedOrgId = typeof requestedOrgHeader === 'string' ? requestedOrgHeader.trim() : undefined;

  try {
    if (requestedOrgId) {
      if (!Types.ObjectId.isValid(requestedOrgId)) {
        next(new AppError('Invalid organisation identifier', 400, 'INVALID_ORG_ID'));
        return;
      }

      const orgObjectId = new Types.ObjectId(requestedOrgId);
      const membership = await MembershipModel.findOne({
        orgId: orgObjectId,
        userId: req.user._id,
      });

      if (!membership) {
        next(new AppError('Not a member of this organisation', 403, 'FORBIDDEN'));
        return;
      }

      req.orgId = membership.orgId;
      req.role = membership.role;
      req.membership = membership;
      next();
      return;
    }

    // No explicit org requested -> resolve user's primary membership
    let membership = await MembershipModel.findOne({ userId: req.user._id }).sort({ createdAt: 1 });

    if (!membership) {
      // Auto-provision personal organisation for user if none exists
      const orgName = req.user.name ? `${req.user.name}'s Farm` : 'Personal Farm';
      const personalOrg = await OrganisationModel.create({
        name: orgName,
      });

      membership = await MembershipModel.create({
        orgId: personalOrg._id,
        userId: req.user._id,
        role: 'admin',
      });

      // Also create self farmer record
      await FarmerModel.create({
        orgId: personalOrg._id,
        userId: req.user._id,
        name: req.user.name || 'Owner',
        language: req.user.language || 'en',
        status: 'active',
      });
    }

    req.orgId = membership.orgId;
    req.role = membership.role;
    req.membership = membership;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Restricts route access to specific organisation roles (e.g. 'admin').
 */
export function requireRole(...allowedRoles: OrganisationRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.role) {
      next(new AppError('Organisation context missing', 403, 'FORBIDDEN'));
      return;
    }

    if (!allowedRoles.includes(req.role)) {
      next(
        new AppError(
          `Permission denied: requires ${allowedRoles.join(' or ')} role`,
          403,
          'FORBIDDEN',
        ),
      );
      return;
    }

    next();
  };
}
