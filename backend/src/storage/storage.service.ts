import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageBackend } from './storage.interface';

// Stores file bytes in Postgres (a separate AttachmentBlob row per file),
// NOT local disk. Render's free-tier disk is ephemeral — wiped on every
// redeploy, which happens on every git push to master — so local-disk
// storage would silently lose every attachment the next time this app
// deploys, with no error anywhere to notice it by. Storing bytes in Neon
// instead avoids that trap entirely and needs no new external account
// (no S3/Cloudinary signup) — fine at a helpdesk's actual attachment scale
// (screenshots, a few KB-MB each). If that ever stops being true, swap this
// for an S3-backed StorageBackend — attachments.service.ts never changes.
@Injectable()
export class StorageService implements StorageBackend {
  constructor(private prisma: PrismaService) {}

  async save(buffer: Buffer, mimeType: string): Promise<string> {
    const blob = await this.prisma.attachmentBlob.create({ data: { data: buffer, mimeType } });
    return blob.id;
  }

  async read(storageKey: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const blob = await this.prisma.attachmentBlob.findUnique({ where: { id: storageKey } });
    if (!blob) return null;
    return { buffer: Buffer.from(blob.data), mimeType: blob.mimeType };
  }

  // deleteMany rather than delete — idempotent, matching this codebase's
  // "archiving/unarchiving an already-{archived,unarchived} ticket is a
  // no-op, not an error" style (tickets.service.ts).
  async delete(storageKey: string): Promise<void> {
    await this.prisma.attachmentBlob.deleteMany({ where: { id: storageKey } });
  }
}
