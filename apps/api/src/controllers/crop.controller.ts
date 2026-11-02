import { Request, Response } from 'express';
import { CROPS } from '@irrigiq/shared';

export class CropController {
  list = (_req: Request, res: Response): void => {
    res.json({
      status: 'success',
      data: {
        crops: CROPS,
      },
    });
  };
}

export const cropController = new CropController();
