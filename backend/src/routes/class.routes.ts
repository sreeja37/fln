import { Router } from 'express';
import { ClassController } from '../controllers/class.controller';
import { authenticate } from '../middlewares/auth';

const router = Router();
const controller = new ClassController();

router.use(authenticate);

router.get('/', controller.getClassesForCurrentTeacher);

export default router;