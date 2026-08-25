import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { StaffRole } from '@ticket-platform/shared';
import { TicketsService } from './tickets.service';

// Covers the attachment methods added 2026-08-25. StorageService itself
// (storage.service.ts) is trivial enough (two Prisma calls) to not need its
// own spec — this mocks it out entirely and focuses on the access-control
// and validation logic that actually has decisions to get wrong.

const AGENT_TECH = { sub: 'agent-1', principalType: 'STAFF', role: StaffRole.AGENT, departmentId: 'dept-tech', orgId: 'org-1' } as any;
const AGENT_SALES = { sub: 'agent-2', principalType: 'STAFF', role: StaffRole.AGENT, departmentId: 'dept-sales', orgId: 'org-1' } as any;
const EMPLOYEE = { sub: 'emp-1', principalType: 'STAFF', role: StaffRole.EMPLOYEE, departmentId: null, orgId: 'org-1' } as any;
const OTHER_EMPLOYEE = { sub: 'emp-2', principalType: 'STAFF', role: StaffRole.EMPLOYEE, departmentId: null, orgId: 'org-1' } as any;

const GOOD_FILE = { buffer: Buffer.from('fake png bytes'), mimetype: 'image/png', originalname: 'error.png', size: 1024 };

function makeHarness(ticketOverrides: Partial<any> = {}, attachmentOverrides: Partial<any> = {}) {
  const attachmentCreateCalls: any[] = [];
  const ticket = { id: 'ticket-1', departmentId: 'dept-tech', customerId: 'cust-emp1', ...ticketOverrides };
  const attachment = {
    id: 'att-1',
    ticketId: 'ticket-1',
    storageKey: 'blob-1',
    fileName: 'error.png',
    mimeType: 'image/png',
    ticket: { departmentId: ticket.departmentId },
    ...attachmentOverrides,
  };
  const prisma = {
    ticket: { findUnique: jest.fn().mockResolvedValue(ticket) },
    attachment: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(attachment),
      create: jest.fn().mockImplementation(({ data }) => {
        attachmentCreateCalls.push(data);
        return { id: 'att-new', ...data };
      }),
    },
    user: {
      findUnique: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(where.id === 'emp-1' ? { id: 'emp-1', email: 'emp1@codevidhya.com' } : { id: 'emp-2', email: 'emp2@codevidhya.com' }),
      ),
    },
    customer: {
      findUnique: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(where.email === 'emp1@codevidhya.com' ? { id: 'cust-emp1' } : { id: 'cust-other' }),
      ),
    },
  };
  const storage = {
    save: jest.fn().mockResolvedValue('blob-new'),
    read: jest.fn().mockResolvedValue({ buffer: Buffer.from('bytes'), mimeType: 'image/png' }),
  };
  const service = new TicketsService(prisma as any, {} as any, {} as any, {} as any, storage as any);
  return { service, prisma, storage, attachmentCreateCalls };
}

describe('TicketsService — staff attachments', () => {
  it('accepts an allowed file type within the size limit', async () => {
    const { service, attachmentCreateCalls, storage } = makeHarness();
    await service.addAttachment(AGENT_TECH, 'ticket-1', GOOD_FILE);
    expect(storage.save).toHaveBeenCalledWith(GOOD_FILE.buffer, 'image/png');
    expect(attachmentCreateCalls[0]).toMatchObject({ ticketId: 'ticket-1', fileName: 'error.png', uploadedByStaffId: 'agent-1' });
  });

  it('rejects a disallowed file type', async () => {
    const { service, storage } = makeHarness();
    await expect(
      service.addAttachment(AGENT_TECH, 'ticket-1', { ...GOOD_FILE, mimetype: 'application/x-msdownload' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('rejects a file over the size limit', async () => {
    const { service, storage } = makeHarness();
    await expect(service.addAttachment(AGENT_TECH, 'ticket-1', { ...GOOD_FILE, size: 6 * 1024 * 1024 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('rejects a staff member outside the ticket\'s department', async () => {
    const { service } = makeHarness();
    await expect(service.addAttachment(AGENT_SALES, 'ticket-1', GOOD_FILE)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('download fetches bytes via storage.read using the attachment\'s storageKey', async () => {
    const { service, storage } = makeHarness();
    const result = await service.getAttachmentOrThrow(AGENT_TECH, 'att-1');
    expect(storage.read).toHaveBeenCalledWith('blob-1');
    expect(result.fileName).toBe('error.png');
  });

  it('download 404s (not 500s) when the blob is missing', async () => {
    const { service, storage } = makeHarness();
    storage.read.mockResolvedValue(null);
    await expect(service.getAttachmentOrThrow(AGENT_TECH, 'att-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TicketsService — employee self-service attachments', () => {
  it('addMyAttachment stores the file against the employee\'s own ticket', async () => {
    const { service, attachmentCreateCalls } = makeHarness();
    await service.addMyAttachment(EMPLOYEE, 'ticket-1', GOOD_FILE);
    expect(attachmentCreateCalls[0]).toMatchObject({ ticketId: 'ticket-1', uploadedByStaffId: 'emp-1' });
  });

  it('rejects an employee who is not this ticket\'s requester', async () => {
    const { service } = makeHarness();
    await expect(service.addMyAttachment(OTHER_EMPLOYEE, 'ticket-1', GOOD_FILE)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.listMyAttachments(OTHER_EMPLOYEE, 'ticket-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getMyAttachmentOrThrow rejects an employee who does not own the attachment\'s ticket', async () => {
    const { service } = makeHarness();
    await expect(service.getMyAttachmentOrThrow(OTHER_EMPLOYEE, 'att-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
