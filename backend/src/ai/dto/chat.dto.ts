import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

// One prior turn of the conversation. The backend is stateless here — the
// frontend keeps the running conversation in React state and resends it in
// full each message (same "v1 simplification" tradeoff as everywhere else
// in this codebase that doesn't have a server-side session store yet).
class ChatTurnDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(4000)
  text: string;
}

export class ChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20) // caps prompt size/cost — older turns just age out of context
  @ValidateNested({ each: true })
  @Type(() => ChatTurnDto)
  history?: ChatTurnDto[];
}
