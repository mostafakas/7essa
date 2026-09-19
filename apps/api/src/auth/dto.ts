import { IsString, Length, MaxLength } from 'class-validator';

export class LoginDto {
  /** اسم المستخدم أو رقم الموبايل */
  @IsString()
  @Length(3, 64)
  identifier!: string;

  @IsString()
  @MaxLength(128)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @Length(8, 128)
  newPassword!: string;
}

export class UpdateMeDto {
  @IsString()
  @Length(2, 80)
  name!: string;
}
