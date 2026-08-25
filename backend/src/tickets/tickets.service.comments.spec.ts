import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { StaffRole } from '@ticket-platform/shared';
import { TicketsService } from './tickets.service';

// Covers the comment methods added alongside the 2026-08-25 audit-followup
// session — separate from tickets.service.spec.ts (assign/escalate/
// acknowledge) since these need their own comment/user/customer mocks.

const AGENT_TECH = { sub: 'agent-1', principalType: 'STAFF', role: StaffRole.AGENT, departmentId: 'dept-tech', orgId: 'org-1' } as any;
const AGENT_SALES = { sub: 'agent-2', principalType: 'STAFF', role: StaffRole.AGENT, departmentId: 'dept-sales', orgId: 'org-1' } as any;
const EMPLOYEE = { sub: 'emp-1', principalType: 'STAFF', role: StaffRole.EMPLOYEE, departmentId: null, orgId: 'org-1' } as any;
const OTHER_EMPLOYEE = { sub: 'emp-2', principalType: 'STAFF', role: StaffRole.EMPLOYEE, departmentId: null, orgId: 'org-1' } as any;

function makeHarness(ticketOverrides: Partial<any> = {}, existingComments: any[] = []) {
  const commentCreateCalls: any[] = [];
  const commentFindManyCalls: any[] = [];
  const ticketUpdateCalls: any[] = [];
  const ticket = { id: 'ticket-1', departmentId: 'dept-tech', customerId: 'cust-emp1', firstRespondedAt: null, ...ticketOverrides };
  const prisma = {
    ticket: {
      findUnique: jest.fn().mockResolvedValue(ticket),
      update: jest.fn().mockImplementation(({ data }) => {
        ticketUpdateCalls.push(data);
        return { ...ticket, ...data };
      }),
    },
    comment: {
      findMany: jest.fn().mockImplementation((args) => {
        commentFindManyCalls.push(args);
        return Promise.resolve(existingComments);
      }),
      create: jest.fn().mockImplementation(({ data }) => {
        commentCreateCalls.push(data);
        return { id: 'comment-new', createdAt: new Date(), staffAuthor: null, customerAuthor: null, ...data };
      }),
    },
    // Backs getMineOrThrow's myCustomerId lookup: emp-1 owns cust-emp1,
    // emp-2 owns a different customer row entirely.
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
  const notifications = { notifyDepartmentManagers: jest.fn(), markReadForTicket: jest.fn() };
  const gemini = { generateJson: jest.fn(), generateText: jest.fn() };
  const service = new TicketsService(prisma as any, {} as any, notifications as any, gemini as any, {} as any);
  return { service, prisma, commentCreateCalls, commentFindManyCalls, ticketUpdateCalls };
}

describe('TicketsService — staff comments (assign/escalate style access)', () => {
  it('defaults a new comment to INTERNAL when no visibility is given', async () => {
    const { service, commentCreateCalls } = makeHarness();
    await service.addComment(AGENT_TECH, 'ticket-1', { body: 'checking with the vendor' } as any);
    expect(commentCreateCalls[0]).toMatchObject({ visibility: 'INTERNAL', staffAuthorId: 'agent-1', body: 'checking with the vendor' });
  });

  it('rejects a staff member outside the ticket\'s department', async () => {
    const { service } = makeHarness();
    await expect(service.addComment(AGENT_SALES, 'ticket-1', { body: 'hi' } as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stamps firstRespondedAt on the first PUBLIC reply', async () => {
    const { service, ticketUpdateCalls } = makeHarness({ firstRespondedAt: null });
    await service.addComment(AGENT_TECH, 'ticket-1', { body: 'we are looking into it', visibility: 'PUBLIC' } as any);
    expect(ticketUpdateCalls).toHaveLength(1);
    expect(ticketUpdateCalls[0]).toHaveProperty('firstRespondedAt');
  });

  it('does not re-stamp firstRespondedAt once already set', async () => {
    const { service, ticketUpdateCalls } = makeHarness({ firstRespondedAt: new Date('2026-08-20T00:00:00Z') });
    await service.addComment(AGENT_TECH, 'ticket-1', { body: 'following up', visibility: 'PUBLIC' } as any);
    expect(ticketUpdateCalls).toHaveLength(0);
  });

  it('does not stamp firstRespondedAt for an INTERNAL note', async () => {
    const { service, ticketUpdateCalls } = makeHarness({ firstRespondedAt: null });
    await service.addComment(AGENT_TECH, 'ticket-1', { body: 'internal only', visibility: 'INTERNAL' } as any);
    expect(ticketUpdateCalls).toHaveLength(0);
  });

  it('listComments returns every visibility (staff sees INTERNAL + PUBLIC)', async () => {
    const existing = [{ id: 'c1', visibility: 'INTERNAL' }, { id: 'c2', visibility: 'PUBLIC' }];
    const { service } = makeHarness({}, existing);
    const result = await service.listComments(AGENT_TECH, 'ticket-1');
    expect(result).toEqual(existing);
  });
});

describe('TicketsService — employee self-service comments', () => {
  it('addMyComment always posts PUBLIC, even though the DTO could carry a visibility field', async () => {
    const { service, commentCreateCalls } = makeHarness();
    await service.addMyComment(EMPLOYEE, 'ticket-1', { body: 'any update?', visibility: 'INTERNAL' } as any);
    expect(commentCreateCalls[0]).toMatchObject({ visibility: 'PUBLIC', staffAuthorId: 'emp-1' });
  });

  it('listMyComments only ever queries for PUBLIC comments', async () => {
    const { service, commentFindManyCalls } = makeHarness();
    await service.listMyComments(EMPLOYEE, 'ticket-1');
    expect(commentFindManyCalls[0].where).toMatchObject({ visibility: 'PUBLIC' });
  });

  it('rejects an employee who is not this ticket\'s requester', async () => {
    const { service } = makeHarness();
    await expect(service.listMyComments(OTHER_EMPLOYEE, 'ticket-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.addMyComment(OTHER_EMPLOYEE, 'ticket-1', { body: 'hi' } as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});
