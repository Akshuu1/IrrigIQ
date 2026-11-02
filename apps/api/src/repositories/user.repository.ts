import { Types } from 'mongoose';
import { UserModel, IUserDocument } from '../models/user.model.js';
import { RegisterInput, UpdateProfileInput } from '../schemas/auth.schema.js';

export class UserRepository {
  async create(data: RegisterInput & { passwordHash: string }): Promise<IUserDocument> {
    const user = new UserModel({
      email: data.email,
      passwordHash: data.passwordHash,
      name: data.name,
      language: data.language,
      areaUnit: data.areaUnit,
    });
    return await user.save();
  }

  async findByEmail(email: string): Promise<IUserDocument | null> {
    return await UserModel.findOne({ email: email.toLowerCase().trim() });
  }

  async findById(id: string | Types.ObjectId): Promise<IUserDocument | null> {
    return await UserModel.findById(id);
  }

  async update(
    id: string | Types.ObjectId,
    data: UpdateProfileInput,
  ): Promise<IUserDocument | null> {
    return await UserModel.findByIdAndUpdate(
      id,
      { $set: data },
      { new: true, runValidators: true },
    );
  }
}

export const userRepository = new UserRepository();
