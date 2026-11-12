import { Request, Response, NextFunction } from 'express';
import { organisationService } from '../services/organisation.service.js';
import {
  createOrgSchema,
  updateOrgSchema,
  addMemberSchema,
  updateMemberRoleSchema,
} from '../schemas/organisation.schema.js';
import { AppError } from '../errors/AppError.js';

export class OrganisationController {
  createOrg = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const input = createOrgSchema.parse(req.body);
      const result = await organisationService.createOrganisation(req.user._id, input.name);

      res.status(201).json({
        status: 'success',
        data: {
          organisation: result.organisation,
          membership: result.membership,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  listOrgs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const orgs = await organisationService.listUserOrganisations(req.user._id);

      res.status(200).json({
        status: 'success',
        data: {
          organisations: orgs,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  getOrg = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const orgId = req.params.orgId as string;
      const org = await organisationService.getOrganisation(orgId, req.user._id);

      res.status(200).json({
        status: 'success',
        data: org,
      });
    } catch (err) {
      next(err);
    }
  };

  updateOrg = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const orgId = req.params.orgId as string;
      const input = updateOrgSchema.parse(req.body);
      const updated = await organisationService.updateOrganisation(orgId, req.user._id, input.name);

      res.status(200).json({
        status: 'success',
        data: {
          organisation: updated,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  listMembers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const orgId = req.params.orgId as string;
      const members = await organisationService.listMembers(orgId, req.user._id);

      res.status(200).json({
        status: 'success',
        data: {
          members,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  addMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const orgId = req.params.orgId as string;
      const input = addMemberSchema.parse(req.body);
      const member = await organisationService.addMember(orgId, req.user._id, input);

      res.status(201).json({
        status: 'success',
        data: {
          member,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  updateMemberRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const orgId = req.params.orgId as string;
      const targetUserId = req.params.userId as string;
      const input = updateMemberRoleSchema.parse(req.body);

      const updated = await organisationService.updateMemberRole(
        orgId,
        req.user._id,
        targetUserId,
        input.role,
      );

      res.status(200).json({
        status: 'success',
        data: {
          membership: updated,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  removeMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const orgId = req.params.orgId as string;
      const targetUserId = req.params.userId as string;

      await organisationService.removeMember(orgId, req.user._id, targetUserId);

      res.status(200).json({
        status: 'success',
        message: 'Member removed successfully',
      });
    } catch (err) {
      next(err);
    }
  };
}

export const organisationController = new OrganisationController();

