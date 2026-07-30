import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.get('/me', (req: AuthenticatedRequest, res: Response) => {
  res.json({ user: req.hrActor });
});

export default router;
