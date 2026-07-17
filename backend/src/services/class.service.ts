import { IClassDocument } from '../interfaces/class.interface';
import { ClassRepository } from '../repositories/class.repository';

export class ClassService {
  private repository: ClassRepository;

  constructor() {
    this.repository = new ClassRepository();
  }

  async getClassesByTeacher(teacherId: string): Promise<IClassDocument[]> {
    return this.repository.findByTeacherId(teacherId);
  }
}