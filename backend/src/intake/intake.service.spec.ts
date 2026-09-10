import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IntakeQueryStatus, StaffRole } from '@ticket-platform/shared';
import { IntakeService } from './intake.service';

// Covers the two things this service must get right: (1) convert() reuses
// TicketsService.create() verbatim rather than duplicating ticket-creation
// logic, and (2) scoping — a non-SUPER_ADMIN can only see/act on queries
// suggested for their own department (intakeQueryScopeWhere), matching
// scope.spec.ts's coverage of that same helper.

const SUPER_ADMIN = { sub: 'u-super', principalType: 'STAFF', role: StaffRole.SUPER_ADMIN, departmentId: null, orgId: 'org-1' } as any;
const TECH_ADMIN = { sub: 'u-tech-admin', principalType: 'STAFF', role: StaffRole.DEPT_ADMIN, departmentId: 'dept-tech', orgId: 'org-1' } as any;

const PENDING_QUERY: {
  id: string;
  orgId: string;
  status: IntakeQueryStatus;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  companyName: string | null;
  subject: string;
  description: string;
  suggestedDepartmentId: string | null;
} = {
  id: 'iq-1',
  orgId: 'org-1',
  status: IntakeQueryStatus.PENDING,
  contactName: 'Jane Doe',
  contactEmail: 'jane@example.com',
  contactPhone: null,
  companyName: null,
  subject: 'Cannot log in',
  description: 'Password reset link never arrives',
  suggestedDepartmentId: 'dept-tech',
};

function makeHarness(overrides: Partial<typeof PENDING_QUERY> = {}) {
  const query = { ...PENDING_QUERY, ...overrides };
  const updateCalls: any[] = [];
  const auditLogCalls: any[] = [];
  const prisma = {
    organization: { findFirst: jest.fn().mockResolvedValue({ id: 'org-1' }) },
    intakeQuery: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn().mockImplementation(({ where }) => {
        // Mirrors what intakeQueryScopeWhere would actually filter out.
        if (where.suggestedDepartmentId && where.suggestedDepartmentId !== query.suggestedDepartmentId) return null;
        return query;
      }),
      update: jest.fn().mockImplementation(({ data }) => updateCalls.push(data)),
    },
    ticket: { findUnique: jest.fn().mockResolvedValue(null) },
    comment: { create: jest.fn() },
    auditLog: { create: jest.fn().mockImplementation(({ data }) => auditLogCalls.push(data)) },
  };
  const customers = { findOrCreateByEmail: jest.fn().mockResolvedValue({ id: 'cust-1', companyId: null }) };
  const tickets = { create: jest.fn().mockResolvedValue({ id: 'ticket-1', autoAssignReasoning: null }) };
  const ai = { classifyDepartment: jest.fn().mockResolvedValue(null) };
  const config = { get: jest.fn() };
  const service = new IntakeService(prisma as any, customers as any, tickets as any, ai as any, config as any);
  return { service, prisma, customers, tickets, ai, config, updateCalls, auditLogCalls };
}

const CONVERT_DTO = { departmentId: 'dept-tech', ticketTypeDefinitionId: 'tt-1', priority: 'MEDIUM' } as any;

describe('IntakeService.convert', () => {
  it('finds-or-creates the customer by email, then delegates to the EXISTING TicketsService.create (no duplicated ticket-creation logic)', async () => {
    const { service, customers, tickets } = makeHarness();
    const ticket = await service.convert(TECH_ADMIN, 'iq-1', CONVERT_DTO);

    expect(customers.findOrCreateByEmail).toHaveBeenCalledWith('org-1', 'Jane Doe', 'jane@example.com', undefined, undefined);
    expect(tickets.create).toHaveBeenCalledWith(TECH_ADMIN, 'dept-tech', {
      ticketTypeDefinitionId: 'tt-1',
      customerId: 'cust-1',
      priority: 'MEDIUM',
      subject: 'Cannot log in',
      description: 'Password reset link never arrives',
      customFields: undefined,
      assignedAgentId: undefined,
    });
    expect(ticket.id).toBe('ticket-1');
  });

  it('marks the query CONVERTED and links the new ticket', async () => {
    const { service, updateCalls } = makeHarness();
    await service.convert(TECH_ADMIN, 'iq-1', CONVERT_DTO);
    expect(updateCalls[0]).toMatchObject({ status: IntakeQueryStatus.CONVERTED, convertedTicketId: 'ticket-1', reviewedByUserId: 'u-tech-admin' });
  });

  it('refuses to convert a query that is not PENDING', async () => {
    const { service } = makeHarness({ status: IntakeQueryStatus.REJECTED });
    await expect(service.convert(TECH_ADMIN, 'iq-1', CONVERT_DTO)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to convert a query with no contact email on file', async () => {
    const { service } = makeHarness({ contactEmail: null });
    await expect(service.convert(TECH_ADMIN, 'iq-1', CONVERT_DTO)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets a human override the suggested department entirely', async () => {
    const { service, tickets } = makeHarness({ suggestedDepartmentId: 'dept-hr' }); // suggested HR...
    await service.convert(SUPER_ADMIN, 'iq-1', { ...CONVERT_DTO, departmentId: 'dept-tech' }); // ...converted into TECH instead
    expect(tickets.create).toHaveBeenCalledWith(SUPER_ADMIN, 'dept-tech', expect.anything());
  });

  it("blocks a non-SUPER_ADMIN from acting on a query suggested for a different department", async () => {
    const { service } = makeHarness({ suggestedDepartmentId: 'dept-hr' });
    await expect(service.convert(TECH_ADMIN, 'iq-1', CONVERT_DTO)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks a non-SUPER_ADMIN from converting into a department that is not theirs', async () => {
    const { service } = makeHarness();
    await expect(service.convert(TECH_ADMIN, 'iq-1', { ...CONVERT_DTO, departmentId: 'dept-ops' })).rejects.toThrow();
  });
});

describe('IntakeService.reject', () => {
  it('marks the query REJECTED with the given reason', async () => {
    const { service, updateCalls } = makeHarness();
    await service.reject(TECH_ADMIN, 'iq-1', { reason: 'Duplicate of another submission' });
    expect(updateCalls[0]).toMatchObject({ status: IntakeQueryStatus.REJECTED, rejectedReason: 'Duplicate of another submission' });
  });

  it('refuses to reject a query that is not PENDING', async () => {
    const { service } = makeHarness({ status: IntakeQueryStatus.CONVERTED });
    await expect(service.reject(TECH_ADMIN, 'iq-1', {})).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('IntakeService.createFromWebForm', () => {
  const DTO = { name: 'Jane', email: 'jane@example.com', subject: 'Cannot log in', description: 'No reset email arrives' } as any;

  it('stores a best-effort AI department suggestion when classification succeeds', async () => {
    const { service, prisma, ai } = makeHarness();
    ai.classifyDepartment.mockResolvedValue({ departmentId: 'dept-tech', reasoning: 'Login issue.' });
    await service.createFromWebForm(DTO);
    expect(prisma.intakeQuery.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ suggestedDepartmentId: 'dept-tech', classificationReasoning: 'Login issue.' }) }),
    );
  });

  it('still creates the query, unrouted, if classification fails (never blocks intake)', async () => {
    const { service, prisma, ai } = makeHarness();
    ai.classifyDepartment.mockRejectedValue(new Error('Gemini outage'));
    await service.createFromWebForm(DTO);
    expect(prisma.intakeQuery.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ suggestedDepartmentId: undefined }) }),
    );
  });
});

describe('IntakeService.handleInboundEmail', () => {
  const EMAIL_EVENT = { type: 'email.received', data: { email_id: 'em_1' } };

  function mockResendFetch(email: { from: string; subject: string; text: string | null }) {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => email });
  }

  it('ignores webhook events that are not email.received', async () => {
    const { service, prisma } = makeHarness();
    const result = await service.handleInboundEmail({ type: 'email.delivered' });
    expect(result).toEqual({ ok: true, skipped: true });
    expect(prisma.intakeQuery.create).not.toHaveBeenCalled();
  });

  it('posts a PUBLIC comment on the existing ticket when the subject carries its display ID and the sender matches its customer', async () => {
    const { service, prisma, config } = makeHarness();
    config.get.mockImplementation((key: string) => (key === 'RESEND_API_KEY' ? 're_key' : undefined));
    mockResendFetch({ from: 'Jane Doe <jane@example.com>', subject: 'Re: [TECH-42] Assigned to you', text: 'Still broken, please help.' });
    prisma.ticket.findUnique.mockResolvedValue({ id: 'ticket-1', orgId: 'org-1', customerId: 'cust-1', customer: { email: 'jane@example.com' } });

    const result = await service.handleInboundEmail(EMAIL_EVENT);

    expect(result).toEqual({ ok: true, action: 'comment_added', ticketId: 'ticket-1' });
    expect(prisma.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ticketId: 'ticket-1', visibility: 'PUBLIC', customerAuthorId: 'cust-1', body: 'Still broken, please help.' }) }),
    );
    expect(prisma.intakeQuery.create).not.toHaveBeenCalled();
  });

  it('stages a new intake query instead when the sender does not match the mentioned ticket\'s customer', async () => {
    const { service, prisma, config } = makeHarness();
    config.get.mockImplementation((key: string) => (key === 'RESEND_API_KEY' ? 're_key' : undefined));
    mockResendFetch({ from: 'Someone Else <someone-else@example.com>', subject: 'Re: [TECH-42] Assigned to you', text: 'What is this about?' });
    prisma.ticket.findUnique.mockResolvedValue({ id: 'ticket-1', orgId: 'org-1', customerId: 'cust-1', customer: { email: 'jane@example.com' } });

    const result = await service.handleInboundEmail(EMAIL_EVENT);

    expect(result).toEqual({ ok: true, action: 'intake_query_created' });
    expect(prisma.intakeQuery.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channel: 'INBOUND_EMAIL', contactEmail: 'someone-else@example.com' }) }),
    );
  });

  it('stages a brand-new intake query when the subject mentions no ticket at all', async () => {
    const { service, prisma, config } = makeHarness();
    config.get.mockImplementation((key: string) => (key === 'RESEND_API_KEY' ? 're_key' : undefined));
    mockResendFetch({ from: 'Jane Doe <jane@example.com>', subject: 'Cannot log in', text: 'Password reset never arrives.' });

    const result = await service.handleInboundEmail(EMAIL_EVENT);

    expect(result).toEqual({ ok: true, action: 'intake_query_created' });
    expect(prisma.intakeQuery.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channel: 'INBOUND_EMAIL', subject: 'Cannot log in' }) }),
    );
  });

  it('skips entirely (never throws) when RESEND_API_KEY is not configured', async () => {
    const { service, prisma, config } = makeHarness();
    config.get.mockReturnValue(undefined);
    (global as any).fetch = jest.fn();

    const result = await service.handleInboundEmail(EMAIL_EVENT);

    expect(result).toEqual({ ok: true, skipped: true });
    expect((global as any).fetch).not.toHaveBeenCalled();
    expect(prisma.intakeQuery.create).not.toHaveBeenCalled();
  });
});
