/**
 * Rules Engine API Routes
 *
 * REST API endpoints for the enterprise Rules Engine system.
 * Following existing HRPulse patterns with Express + Zod validation.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../db/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { ruleEngineService } from '../services/rulesEngineService';

const router = Router();

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const ruleCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required'),
  description: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  parentId: z.number().optional(),
  isActive: z.boolean().optional(),
});

const ruleConditionSchema = z.object({
  id: z.number().optional(),
  parentId: z.number().optional(),
  logicalOperator: z.enum(['AND', 'OR']).optional(),
  field: z.string().min(1, 'Field is required'),
  operator: z.enum(['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'contains', 'notContains', 'startsWith', 'endsWith', 'in', 'notIn', 'between']),
  value: z.string(),
  valueType: z.enum(['string', 'number', 'boolean', 'date', 'list', 'json']),
  displayOrder: z.number().default(0),
});

const ruleActionSchema = z.object({
  id: z.number().optional(),
  groupId: z.number().optional(),
  actionType: z.enum(['set', 'add', 'subtract', 'multiply', 'divide', 'sendNotification', 'approve', 'reject', 'calculate', 'validate']),
  targetField: z.string().optional(),
  value: z.string().optional(),
  valueType: z.enum(['fixed', 'fieldReference', 'formula', 'percentage']).optional(),
  formula: z.string().optional(),
  amount: z.number().optional(),
  percent: z.number().optional(),
  notificationTemplate: z.string().optional(),
  notificationRecipients: z.string().optional(),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  roundTo: z.number().optional(),
  displayOrder: z.number().default(0),
});

const ruleSchema = z.object({
  name: z.string().min(1, 'Rule name is required'),
  description: z.string().optional(),
  categoryId: z.number().positive('Valid category ID is required'),
  ruleType: z.enum(['attendance', 'payroll', 'leave', 'hr', 'hospital', 'incentive', 'notification', 'compliance', 'custom']),
  isActive: z.boolean().optional(),
  priority: z.number().default(0),
  executionMode: z.enum(['sync', 'async']).default('sync'),
  conditions: z.array(ruleConditionSchema).default([]),
  actions: z.array(ruleActionSchema).default([]),
  createdBy: z.string().optional(),
  modifiedBy: z.string().optional(),
});

const evaluateRulesSchema = z.object({
  context: z.object({}).passthrough(),
  ruleType: z.enum(['attendance', 'payroll', 'leave', 'hr', 'hospital', 'incentive', 'notification', 'compliance', 'custom']).optional(),
  ruleId: z.number().optional(),
  employeeId: z.number().optional(),
});

const testRuleSchema = z.object({
  ruleId: z.number().positive('Rule ID is required'),
  testData: z.object({}).passthrough(),
  options: z.object({
    dryRun: z.boolean().optional(),
    verbose: z.boolean().optional(),
    returnFullDetails: z.boolean().optional(),
  }).optional(),
});

// =============================================================================
// RULE CATEGORIES ENDPOINTS
// =============================================================================

/**
 * GET /api/rules-engine/categories
 * List all rule categories
 */
router.get('/categories', requireAuth, async (_req: Request, res: Response) => {
  try {
    const categories = await prisma.ruleCategory.findMany({
      where: { isActive: true },
      include: {
        subcategories: {
          where: { isActive: true },
        },
        _count: {
          select: { rules: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

/**
 * POST /api/rules-engine/categories
 * Create a new rule category
 */
router.post('/categories', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const parsed = ruleCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid category data',
        details: parsed.error.flatten(),
      });
      return;
    }

    const category = await prisma.ruleCategory.create({
      data: parsed.data,
    });

    res.status(201).json(category);
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

/**
 * PUT /api/rules-engine/categories/:id
 * Update a rule category
 */
router.put('/categories/:id', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const parsed = ruleCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid category data',
        details: parsed.error.flatten(),
      });
      return;
    }

    const category = await prisma.ruleCategory.update({
      where: { id },
      data: parsed.data,
    });

    res.json(category);
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// =============================================================================
// RULES ENDPOINTS
// =============================================================================

/**
 * GET /api/rules-engine/rules
 * List all rules with optional filtering
 */
router.get('/rules', requireAuth, async (req: Request, res: Response) => {
  try {
    const { categoryId, ruleType, status, search } = req.query;

    const where: any = {};

    if (categoryId) {
      where.categoryId = parseInt(categoryId as string);
    }

    if (ruleType) {
      where.ruleType = ruleType;
    }

    if (status === 'active') {
      where.isActive = true;
    } else if (status === 'inactive') {
      where.isActive = false;
    }

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const rules = await prisma.rule.findMany({
      where,
      include: {
        category: true,
        conditions: {
          orderBy: { displayOrder: 'asc' },
        },
        actions: {
          orderBy: { displayOrder: 'asc' },
        },
        _count: {
          select: {
            logs: { where: { executedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } },
            versions: true,
            approvals: { where: { status: 'pending' } },
          },
        },
      },
      orderBy: { priority: 'desc' },
    });

    res.json(rules);
  } catch (error) {
    console.error('Error fetching rules:', error);
    res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

/**
 * GET /api/rules-engine/rules/:id
 * Get a single rule by ID
 */
router.get('/rules/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const rule = await prisma.rule.findUnique({
      where: { id },
      include: {
        category: true,
        conditions: {
          orderBy: { displayOrder: 'asc' },
        },
        actions: {
          orderBy: { displayOrder: 'asc' },
        },
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 10,
        },
        approvals: {
          orderBy: { requestedAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!rule) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    res.json(rule);
  } catch (error) {
    console.error('Error fetching rule:', error);
    res.status(500).json({ error: 'Failed to fetch rule' });
  }
});

/**
 * POST /api/rules-engine/rules
 * Create a new rule
 */
router.post('/rules', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid rule data',
        details: parsed.error.flatten(),
      });
      return;
    }

    const { conditions, actions, createdBy, ...ruleData } = parsed.data;

    // Create rule
    const rule = await prisma.rule.create({
      data: {
        ...ruleData,
        createdBy: createdBy || req.user?.email || 'system',
        conditions: {
          create: conditions.map((c, index) => ({
            ...c,
            displayOrder: index,
          })),
        },
        actions: {
          create: actions.map((a, index) => ({
            ...a,
            displayOrder: index,
          })),
        },
      },
      include: {
        category: true,
        conditions: true,
        actions: true,
      },
    });

    // Create initial version
    await prisma.ruleVersion.create({
      data: {
        ruleId: rule.id,
        versionNumber: 1,
        name: rule.name,
        description: rule.description,
        conditions: rule.conditions,
        actions: rule.actions,
        modifiedBy: rule.createdBy,
        changeSummary: 'Initial version',
      },
    });

    res.status(201).json(rule);
  } catch (error) {
    console.error('Error creating rule:', error);
    res.status(500).json({ error: 'Failed to create rule' });
  }
});

/**
 * PUT /api/rules-engine/rules/:id
 * Update an existing rule
 */
router.put('/rules/:id', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid rule data',
        details: parsed.error.flatten(),
      });
      return;
    }

    const { conditions, actions, modifiedBy, ...ruleData } = parsed.data;

    // Get current version number
    const currentVersions = await prisma.ruleVersion.findMany({
      where: { ruleId: id },
      orderBy: { versionNumber: 'desc' },
      take: 1,
    });

    const nextVersion = (currentVersions[0]?.versionNumber || 0) + 1;

    // Delete existing conditions and actions
    await prisma.ruleCondition.deleteMany({ where: { ruleId: id } });
    await prisma.ruleAction.deleteMany({ where: { ruleId: id } });

    // Update rule
    const rule = await prisma.rule.update({
      where: { id },
      data: {
        ...ruleData,
        modifiedBy: modifiedBy || req.user?.email || 'system',
        conditions: {
          create: conditions.map((c, index) => ({
            ...c,
            displayOrder: index,
          })),
        },
        actions: {
          create: actions.map((a, index) => ({
            ...a,
            displayOrder: index,
          })),
        },
      },
      include: {
        category: true,
        conditions: true,
        actions: true,
      },
    });

    // Create new version
    await prisma.ruleVersion.create({
      data: {
        ruleId: rule.id,
        versionNumber: nextVersion,
        name: rule.name,
        description: rule.description,
        conditions: rule.conditions,
        actions: rule.actions,
        modifiedBy: modifiedBy || req.user?.email || 'system',
        changeSummary: 'Rule updated',
      },
    });

    res.json(rule);
  } catch (error) {
    console.error('Error updating rule:', error);
    res.status(500).json({ error: 'Failed to update rule' });
  }
});

/**
 * DELETE /api/rules-engine/rules/:id
 * Delete a rule
 */
router.delete('/rules/:id', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.rule.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting rule:', error);
    res.status(500).json({ error: 'Failed to delete rule' });
  }
});

/**
 * PATCH /api/rules-engine/rules/:id/toggle
 * Toggle rule active status
 */
router.patch('/rules/:id/toggle', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const rule = await prisma.rule.findUnique({ where: { id } });

    if (!rule) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    const updated = await prisma.rule.update({
      where: { id },
      data: { isActive: !rule.isActive },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error toggling rule:', error);
    res.status(500).json({ error: 'Failed to toggle rule' });
  }
});

/**
 * POST /api/rules-engine/rules/:id/duplicate
 * Clone/duplicate an existing rule
 */
router.post('/rules/:id/duplicate', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);

    // Get original rule
    const original = await prisma.rule.findUnique({
      where: { id },
      include: {
        conditions: true,
        actions: true,
      },
    });

    if (!original) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    // Create duplicate
    const duplicate = await prisma.rule.create({
      data: {
        name: `${original.name} (Copy)`,
        description: original.description,
        categoryId: original.categoryId,
        ruleType: original.ruleType,
        priority: original.priority,
        executionMode: original.executionMode,
        isActive: false, // Start inactive
        createdBy: req.user?.email || 'system',
        conditions: {
          create: original.conditions.map((c) => ({
            field: c.field,
            operator: c.operator,
            value: c.value,
            valueType: c.valueType,
            logicalOperator: c.logicalOperator,
            parentId: c.parentId,
            displayOrder: c.displayOrder,
          })),
        },
        actions: {
          create: original.actions.map((a) => ({
            actionType: a.actionType,
            targetField: a.targetField,
            value: a.value,
            valueType: a.valueType,
            formula: a.formula,
            amount: a.amount,
            percent: a.percent,
            notificationTemplate: a.notificationTemplate,
            notificationRecipients: a.notificationRecipients,
            minValue: a.minValue,
            maxValue: a.maxValue,
            roundTo: a.roundTo,
            displayOrder: a.displayOrder,
          })),
        },
      },
      include: {
        category: true,
        conditions: true,
        actions: true,
      },
    });

    // Create initial version for duplicate
    await prisma.ruleVersion.create({
      data: {
        ruleId: duplicate.id,
        versionNumber: 1,
        name: duplicate.name,
        description: duplicate.description,
        conditions: duplicate.conditions,
        actions: duplicate.actions,
        modifiedBy: duplicate.createdBy,
        changeSummary: 'Duplicated from rule ' + original.id,
      },
    });

    res.status(201).json(duplicate);
  } catch (error) {
    console.error('Error duplicating rule:', error);
    res.status(500).json({ error: 'Failed to duplicate rule' });
  }
});

// =============================================================================
// RULE EVALUATION ENDPOINTS
// =============================================================================

/**
 * POST /api/rules-engine/rules/evaluate
 * Evaluate rules against provided context
 */
router.post('/rules/evaluate', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = evaluateRulesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid evaluation request',
        details: parsed.error.flatten(),
      });
      return;
    }

    const { context, ruleType } = parsed.data;

    // Evaluate rules
    const results = await ruleEngineService.evaluateAllRules(context, {
      ruleType,
    });

    res.json(results);
  } catch (error) {
    console.error('Error evaluating rules:', error);
    res.status(500).json({ error: 'Failed to evaluate rules' });
  }
});

/**
 * POST /api/rules-engine/rules/test
 * Test a rule with sample data (dry run)
 */
router.post('/rules/test', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = testRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid test request',
        details: parsed.error.flatten(),
      });
      return;
    }

    const { ruleId, testData, options } = parsed.data;

    // Get the rule
    const rule = await prisma.rule.findUnique({
      where: { id: ruleId },
      include: {
        conditions: {
          orderBy: { displayOrder: 'asc' },
        },
        actions: {
          orderBy: { displayOrder: 'asc' },
        },
      },
    });

    if (!rule) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    // Test the rule
    const startTime = Date.now();
    const result = await ruleEngineService.evaluateRule(rule, testData);
    const testDuration = Date.now() - startTime;

    res.json({
      ruleId: rule.id,
      ruleName: rule.name,
      matched: result.matched,
      testDuration,
      results: [result],
      warnings: result.matched ? [] : ['No conditions matched'],
      errors: result.errorMessage ? [result.errorMessage] : [],
    });
  } catch (error) {
    console.error('Error testing rule:', error);
    res.status(500).json({ error: 'Failed to test rule' });
  }
});

// =============================================================================
// RULE ANALYTICS ENDPOINTS
// =============================================================================

/**
 * GET /api/rules-engine/analytics/kpis
 * Get KPI metrics for dashboard
 */
router.get('/analytics/kpis', requireAuth, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get total rules
    const totalRules = await prisma.rule.count();
    const activeRules = await prisma.rule.count({ where: { isActive: true } });
    const inactiveRules = totalRules - activeRules;

    // Get executions today
    const executionsToday = await prisma.ruleExecutionLog.count({
      where: {
        executedAt: { gte: startOfDay },
      },
    });

    // Get failed executions
    const failedExecutions = await prisma.ruleExecutionLog.count({
      where: {
        status: 'failed',
        executedAt: { gte: startOfDay },
      },
    });

    // Get pending approvals
    const pendingApproval = await prisma.ruleApproval.count({
      where: { status: 'pending' },
    });

    res.json({
      totalRules,
      activeRules,
      inactiveRules,
      rulesExecutedToday: executionsToday,
      failedExecutions,
      pendingApproval,
    });
  } catch (error) {
    console.error('Error fetching KPIs:', error);
    res.status(500).json({ error: 'Failed to fetch KPIs' });
  }
});

/**
 * GET /api/rules-engine/analytics
 * Get detailed analytics data
 */
router.get('/analytics', requireAuth, async (req: Request, res: Response) => {
  try {
    const { dateFrom, dateTo, ruleType, categoryId } = req.query;

    const dateFilter: any = {};
    if (dateFrom) {
      dateFilter.gte = new Date(dateFrom as string);
    }
    if (dateTo) {
      dateFilter.lte = new Date(dateTo as string);
    }

    // Get execution metrics
    const totalExecutions = await prisma.ruleExecutionLog.count({
      where: Object.assign(
        {},
        dateFilter && { executedAt: dateFilter }
      ),
    });

    const successExecutions = await prisma.ruleExecutionLog.count({
      where: Object.assign(
        { status: 'success' },
        dateFilter && { executedAt: dateFilter }
      ),
    });

    const failedExecutions = await prisma.ruleExecutionLog.count({
      where: Object.assign(
        { status: 'failed' },
        dateFilter && { executedAt: dateFilter }
      ),
    });

    // Get average execution time
    const avgExecutionTime = await prisma.ruleExecutionLog.aggregate({
      where: Object.assign(
        { executionDuration: { not: null } },
        dateFilter && { executedAt: dateFilter }
      ),
      _avg: {
        executionDuration: true,
      },
    });

    // Get most executed rules
    const mostExecutedRules = await prisma.ruleExecutionLog.groupBy({
      by: ['ruleId'],
      where: dateFilter && { executedAt: dateFilter },
      _count: {
        ruleId: true,
      },
      orderBy: {
        _count: {
          ruleId: 'desc',
        },
      },
      take: 10,
    });

    // Get category usage
    const categoryUsage = await prisma.rule.groupBy({
      by: ['categoryId'],
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
    });

    res.json({
      totalExecutions,
      successExecutions,
      failedExecutions,
      averageExecutionTime: avgExecutionTime._avg.executionDuration || 0,
      mostExecutedRules: mostExecutedRules.map((r) => ({
        ruleId: r.ruleId,
        executionCount: r._count.ruleId,
      })),
      categoryUsage: categoryUsage.map((c) => ({
        categoryId: c.categoryId,
        ruleCount: c._count.id,
      })),
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// =============================================================================
// RULE LOGS ENDPOINTS
// =============================================================================

/**
 * GET /api/rules-engine/logs
 * Get rule execution logs with filtering
 */
router.get('/logs', requireAuth, async (req: Request, res: Response) => {
  try {
    const {
      ruleId,
      employeeId,
      status,
      dateFrom,
      dateTo,
      page = '1',
      limit = '50',
    } = req.query;

    const where: any = {};

    if (ruleId) {
      where.ruleId = parseInt(ruleId as string);
    }

    if (employeeId) {
      where.employeeId = parseInt(employeeId as string);
    }

    if (status) {
      where.status = status;
    }

    if (dateFrom || dateTo) {
      where.executedAt = {};
      if (dateFrom) {
        where.executedAt.gte = new Date(dateFrom as string);
      }
      if (dateTo) {
        where.executedAt.lte = new Date(dateTo as string);
      }
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    const [logs, total] = await Promise.all([
      prisma.ruleExecutionLog.findMany({
        where,
        include: {
          rule: {
            select: {
              name: true,
              ruleType: true,
            },
          },
        },
        orderBy: { executedAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.ruleExecutionLog.count({ where }),
    ]);

    res.json({
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// =============================================================================
// RULE VERSIONS ENDPOINTS
// =============================================================================

/**
 * GET /api/rules-engine/rules/:id/versions
 * Get version history for a rule
 */
router.get('/rules/:id/versions', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const versions = await prisma.ruleVersion.findMany({
      where: { ruleId: id },
      orderBy: { versionNumber: 'desc' },
    });

    res.json(versions);
  } catch (error) {
    console.error('Error fetching versions:', error);
    res.status(500).json({ error: 'Failed to fetch versions' });
  }
});

/**
 * POST /api/rules-engine/rules/:id/versions/rollback
 * Rollback a rule to a specific version
 */
router.post('/rules/:id/versions/rollback', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { versionNumber } = req.body;

    if (!versionNumber) {
      res.status(400).json({ error: 'Version number is required' });
      return;
    }

    // Get target version
    const targetVersion = await prisma.ruleVersion.findFirst({
      where: {
        ruleId: id,
        versionNumber: parseInt(versionNumber),
      },
    });

    if (!targetVersion) {
      res.status(404).json({ error: 'Version not found' });
      return;
    }

    // Delete existing conditions and actions
    await prisma.ruleCondition.deleteMany({ where: { ruleId: id } });
    await prisma.ruleAction.deleteMany({ where: { ruleId: id } });

    // Recreate conditions and actions from version
    const conditions = targetVersion.conditions as any[];
    const actions = targetVersion.actions as any[];

    await prisma.ruleCondition.createMany({
      data: conditions.map((c: any) => ({
        ruleId: id,
        ...c,
      })),
      skipDuplicates: true,
    });

    await prisma.ruleAction.createMany({
      data: actions.map((a: any) => ({
        ruleId: id,
        ...a,
      })),
      skipDuplicates: true,
    });

    // Update rule
    const rule = await prisma.rule.update({
      where: { id },
      data: {
        name: targetVersion.name,
        description: targetVersion.description,
        modifiedBy: req.user?.email || 'system',
      },
    });

    // Create rollback version
    const currentVersions = await prisma.ruleVersion.findMany({
      where: { ruleId: id },
      orderBy: { versionNumber: 'desc' },
      take: 1,
    });

    await prisma.ruleVersion.create({
      data: {
        ruleId: id,
        versionNumber: (currentVersions[0]?.versionNumber || 0) + 1,
        name: rule.name,
        description: rule.description,
        conditions: targetVersion.conditions,
        actions: targetVersion.actions,
        modifiedBy: req.user?.email || 'system',
        changeSummary: `Rolled back to version ${versionNumber}`,
        isRollback: true,
      },
    });

    res.json(rule);
  } catch (error) {
    console.error('Error rolling back version:', error);
    res.status(500).json({ error: 'Failed to rollback version' });
  }
});

// =============================================================================
// RULE APPROVAL ENDPOINTS
// =============================================================================

/**
 * GET /api/rules-engine/rules/:id/approvals
 * Get approval history for a rule
 */
router.get('/rules/:id/approvals', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const approvals = await prisma.ruleApproval.findMany({
      where: { ruleId: id },
      orderBy: { requestedAt: 'desc' },
    });

    res.json(approvals);
  } catch (error) {
    console.error('Error fetching approvals:', error);
    res.status(500).json({ error: 'Failed to fetch approvals' });
  }
});

/**
 * POST /api/rules-engine/rules/:id/submit-approval
 * Submit a rule for approval
 */
router.post('/rules/:id/submit-approval', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { changeSummary, changes, requiredApprovals = 1 } = req.body;

    const approval = await prisma.ruleApproval.create({
      data: {
        ruleId: id,
        requestedBy: req.user?.email || 'system',
        requestType: 'update',
        changeSummary,
        changes,
        requiredApprovals,
        approvers: [], // To be configured based on organization
        status: 'pending',
      },
    });

    res.status(201).json(approval);
  } catch (error) {
    console.error('Error submitting approval:', error);
    res.status(500).json({ error: 'Failed to submit approval' });
  }
});

/**
 * POST /api/rules-engine/approvals/:id/approve
 * Approve a rule change
 */
router.post('/approvals/:id/approve', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { comments } = req.body;

    const approval = await prisma.ruleApproval.update({
      where: { id },
      data: {
        status: 'approved',
        approvedBy: req.user?.email || 'system',
        approvedAt: new Date(),
      },
    });

    res.json(approval);
  } catch (error) {
    console.error('Error approving rule:', error);
    res.status(500).json({ error: 'Failed to approve rule' });
  }
});

/**
 * POST /api/rules-engine/approvals/:id/reject
 * Reject a rule change
 */
router.post('/approvals/:id/reject', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { rejectionReason } = req.body;

    if (!rejectionReason) {
      res.status(400).json({ error: 'Rejection reason is required' });
      return;
    }

    const approval = await prisma.ruleApproval.update({
      where: { id },
      data: {
        status: 'rejected',
        approvedBy: req.user?.email || 'system',
        rejectionReason,
      },
    });

    res.json(approval);
  } catch (error) {
    console.error('Error rejecting rule:', error);
    res.status(500).json({ error: 'Failed to reject rule' });
  }
});

// =============================================================================
// IMPORT/EXPORT ENDPOINTS
// =============================================================================

/**
 * GET /api/rules-engine/export
 * Export rules as JSON
 */
router.get('/export', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { ruleIds, categories, includeVersions = 'false' } = req.query;

    const where: any = { isActive: true };

    if (ruleIds) {
      where.id = { in: (ruleIds as string).split(',').map(Number) };
    }

    if (categories) {
      where.categoryId = { in: (categories as string).split(',').map(Number) };
    }

    const rules = await prisma.rule.findMany({
      where,
      include: {
        category: true,
        conditions: true,
        actions: true,
        ...(includeVersions === 'true' && {
          versions: {
            orderBy: { versionNumber: 'desc' },
          },
        }),
      },
    });

    // Set headers for JSON download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=rules-engine-export-${Date.now()}.json`);

    res.json(rules);
  } catch (error) {
    console.error('Error exporting rules:', error);
    res.status(500).json({ error: 'Failed to export rules' });
  }
});

/**
 * POST /api/rules-engine/import
 * Import rules from JSON
 */
router.post('/import', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { rules, validateOnly = 'false', overwriteExisting = 'false' } = req.body;

    if (!Array.isArray(rules)) {
      res.status(400).json({ error: 'Rules must be an array' });
      return;
    }

    const results = {
      imported: 0,
      failed: 0,
      errors: [] as any[],
      warnings: [] as string[],
    };

    for (const rule of rules) {
      try {
        if (validateOnly === 'true') {
          // Just validate the rule structure
          const parsed = ruleSchema.safeParse(rule);
          if (!parsed.success) {
            results.failed++;
            results.errors.push({
              rule: rule.name || 'Unknown',
              error: parsed.error.flatten(),
            });
          }
        } else {
          // Import the rule
          const existingRule = await prisma.rule.findFirst({
            where: { name: rule.name },
          });

          if (existingRule && overwriteExisting !== 'true') {
            results.warnings.push(`Rule "${rule.name}" already exists, skipping`);
            continue;
          }

          await prisma.rule.upsert({
            where: { id: existingRule?.id || 0 },
            create: {
              name: rule.name,
              description: rule.description,
              categoryId: rule.categoryId,
              ruleType: rule.ruleType,
              priority: rule.priority,
              executionMode: rule.executionMode,
              isActive: rule.isActive,
              createdBy: req.user?.email || 'import',
              conditions: {
                create: rule.conditions?.map((c: any, i: number) => ({
                  ...c,
                  displayOrder: i,
                })) || [],
              },
              actions: {
                create: rule.actions?.map((a: any, i: number) => ({
                  ...a,
                  displayOrder: i,
                })) || [],
              },
            },
            update: {
              name: rule.name,
              description: rule.description,
              categoryId: rule.categoryId,
              ruleType: rule.ruleType,
              priority: rule.priority,
              executionMode: rule.executionMode,
              isActive: rule.isActive,
              modifiedBy: req.user?.email || 'import',
            },
          });

          results.imported++;
        }
      } catch (error) {
        results.failed++;
        results.errors.push({
          rule: rule.name || 'Unknown',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    res.json(results);
  } catch (error) {
    console.error('Error importing rules:', error);
    res.status(500).json({ error: 'Failed to import rules' });
  }
});

export default router;
