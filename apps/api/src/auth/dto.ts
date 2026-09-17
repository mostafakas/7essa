import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @MaxLength(32)
  phone!: string;
}

export class VerifyOtpDto {
  @IsString()
  @MaxLength(32)
  phone!: string;

  @Matches(/^\d{6}$/, { message: 'الرمز 6 أرقام' })
  code!: string;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;
}

export class UpdateMeDto {
  @IsString()
  @Length(2, 80)
  name!: string;
}
