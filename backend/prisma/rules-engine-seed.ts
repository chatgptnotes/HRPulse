/**
 * Rules Engine Seed Data
 *
 * This script creates default rule categories for the enterprise Rules Engine system.
 * Run with: npx tsx backend/prisma/rules-engine-seed.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const defaultCategories = [
  {
    name: 'Attendance',
    description: 'Attendance tracking and status rules',
    icon: 'schedule',
    color: 'bg-blue-500',
  },
  {
    name: 'Payroll',
    description: 'Salary calculation and deduction rules',
    icon: 'payments',
    color: 'bg-green-500',
  },
  {
    name: 'Leave Management',
    description: 'Leave balance and approval rules',
    icon: 'event_busy',
    color: 'bg-purple-500',
  },
  {
    name: 'HR Operations',
    description: 'Employee lifecycle and HR processes',
    icon: 'people',
    color: 'bg-pink-500',
  },
  {
    name: 'Hospital Billing',
    description: 'Hospital billing and invoice rules',
    icon: 'local_hospital',
    color: 'bg-red-500',
  },
  {
    name: 'Incentives',
    description: 'Performance and incentive calculations',
    icon: 'emoji_events',
    color: 'bg-amber-500',
  },
  {
    name: 'Notifications',
    description: 'Alert and notification triggers',
    icon: 'notifications',
    color: 'bg-indigo-500',
  },
  {
    name: 'Compliance',
    description: 'Regulatory and policy compliance rules',
    icon: 'verified_user',
    color: 'bg-teal-500',
  },
  {
    name: 'Security',
    description: 'Access control and security rules',
    icon: 'security',
    color: 'bg-slate-500',
  },
  {
    name: 'Custom',
    description: 'User-defined custom rules',
    icon: 'tune',
    color: 'bg-gray-500',
  },
];

/**
 * Sample rules for testing the Rules Engine
 */
const sampleRules = [
  {
    name: 'Half Day Attendance Rule',
    description: 'Mark half day if working hours are less than 4 hours',
    categoryName: 'Attendance',
    ruleType: 'attendance' as const,
    priority: 10,
    executionMode: 'sync' as const,
    conditions: [
      {
        field: 'attendance.workingHours',
        operator: 'lt' as const,
        value: '4',
        valueType: 'number' as const,
        logicalOperator: null,
        displayOrder: 1,
      },
    ],
    actions: [
      {
        actionType: 'set' as const,
        targetField: 'attendance.status',
        value: 'half_day',
        valueType: 'fixed' as const,
        displayOrder: 1,
      },
    ],
    createdBy: 'system',
  },
  {
    name: 'Late Deduction Rule',
    description: 'Deduct ₹500 from salary if employee is late more than 3 times in a month',
    categoryName: 'Payroll',
    ruleType: 'payroll' as const,
    priority: 15,
    executionMode: 'sync' as const,
    conditions: [
      {
        field: 'attendance.lateCount',
        operator: 'gt' as const,
        value: '3',
        valueType: 'number' as const,
        logicalOperator: null,
        displayOrder: 1,
      },
    ],
    actions: [
      {
        actionType: 'subtract' as const,
        targetField: 'salary.netSalary',
        amount: 500,
        valueType: 'fixed' as const,
        displayOrder: 1,
      },
    ],
    createdBy: 'system',
  },
  {
    name: 'Sunday Overtime Multiplier',
    description: 'Apply 2x multiplier for overtime on Sundays',
    categoryName: 'Payroll',
    ruleType: 'payroll' as const,
    priority: 20,
    executionMode: 'sync' as const,
    conditions: [
      {
        field: 'attendance.dayOfWeek',
        operator: 'eq' as const,
        value: 'Sunday',
        valueType: 'string' as const,
        logicalOperator: null,
        displayOrder: 1,
      },
      {
        field: 'attendance.overtimeHours',
        operator: 'gt' as const,
        value: '0',
        valueType: 'number' as const,
        logicalOperator: 'AND' as const,
        displayOrder: 2,
      },
    ],
    actions: [
      {
        actionType: 'multiply' as const,
        targetField: 'salary.overtimePay',
        percent: 200,
        valueType: 'percentage' as const,
        displayOrder: 1,
      },
    ],
    createdBy: 'system',
  },
  {
    name: 'Leave Balance Notification',
    description: 'Send notification when leave balance falls to 2 or less',
    categoryName: 'Notifications',
    ruleType: 'notification' as const,
    priority: 5,
    executionMode: 'async' as const,
    conditions: [
      {
        field: 'leave.balance',
        operator: 'lte' as const,
        value: '2',
        valueType: 'number' as const,
        logicalOperator: null,
        displayOrder: 1,
      },
    ],
    actions: [
      {
        actionType: 'sendNotification' as const,
        notificationTemplate: 'low_leave_balance',
        notificationRecipients: '["employee", "hr_manager"]',
        displayOrder: 1,
      },
    ],
    createdBy: 'system',
  },
  {
    name: 'PF Deduction Rule',
    description: 'Deduct 12% of basic salary as Provident Fund',
    categoryName: 'Payroll',
    ruleType: 'payroll' as const,
    priority: 25,
    executionMode: 'sync' as const,
    conditions: [
      {
        field: 'salary.basicSalary',
        operator: 'gte' as const,
        value: '15000',
        valueType: 'number' as const,
        logicalOperator: null,
        displayOrder: 1,
      },
    ],
    actions: [
      {
        actionType: 'subtract' as const,
        targetField: 'salary.providentFund',
        percent: 12,
        valueType: 'percentage' as const,
        displayOrder: 1,
      },
    ],
    createdBy: 'system',
  },
];

async function seedCategories() {
  console.log('🌱 Seeding default rule categories...');

  for (const category of defaultCategories) {
    await prisma.ruleCategory.upsert({
      where: { name: category.name },
      update: {},
      create: category,
    });
    console.log(`✅ Created category: ${category.name}`);
  }

  console.log('✅ Default categories seeded successfully');
}

async function seedSampleRules() {
  console.log('🌱 Seeding sample rules for testing...');

  for (const rule of sampleRules) {
    // Find category ID
    const category = await prisma.ruleCategory.findUnique({
      where: { name: rule.categoryName },
    });

    if (!category) {
      console.log(`⚠️  Category not found: ${rule.categoryName}, skipping rule: ${rule.name}`);
      continue;
    }

    // Check if rule already exists
    const existingRule = await prisma.rule.findFirst({
      where: { name: rule.name },
    });

    if (existingRule) {
      console.log(`⏭️  Rule already exists: ${rule.name}, skipping...`);
      continue;
    }

    // Create rule
    const createdRule = await prisma.rule.create({
      data: {
        name: rule.name,
        description: rule.description,
        categoryId: category.id,
        ruleType: rule.ruleType,
        priority: rule.priority,
        executionMode: rule.executionMode,
        isActive: true,
        createdBy: rule.createdBy,
      },
    });

    // Create conditions
    for (const condition of rule.conditions) {
      await prisma.ruleCondition.create({
        data: {
          ruleId: createdRule.id,
          field: condition.field,
          operator: condition.operator,
          value: JSON.stringify(condition.value),
          valueType: condition.valueType,
          logicalOperator: condition.logicalOperator,
          displayOrder: condition.displayOrder,
        },
      });
    }

    // Create actions
    for (const action of rule.actions) {
      await prisma.ruleAction.create({
        data: {
          ruleId: createdRule.id,
          actionType: action.actionType,
          targetField: action.targetField,
          value: action.value ? JSON.stringify(action.value) : undefined,
          valueType: action.valueType,
          amount: action.amount,
          percent: action.percent,
          notificationTemplate: action.notificationTemplate,
          notificationRecipients: action.notificationRecipients,
          displayOrder: action.displayOrder,
        },
      });
    }

    console.log(`✅ Created sample rule: ${rule.name}`);
  }

  console.log('✅ Sample rules seeded successfully');
}

async function main() {
  try {
    await seedCategories();
    await seedSampleRules();
  } catch (error) {
    console.error('❌ Error seeding data:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
