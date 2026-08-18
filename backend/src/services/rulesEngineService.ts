/**
 * Rules Engine Service
 *
 * Core service for evaluating and executing business rules dynamically.
 * This service handles rule evaluation, condition matching, and action execution
 * following the existing HRPulse patterns and architecture.
 */

import { PrismaClient, Rule, RuleCondition, RuleAction, RuleExecutionLog } from '@prisma/client';
import {
  RuleEvaluationContext,
  RuleEvaluationResult,
  RuleEvaluationSummary,
  BatchRuleEvaluationOptions,
  ExecutedAction,
  ConditionOperator,
  ActionType,
} from '../../shared/types/rules';

const prisma = new PrismaClient();

export class RuleEngineService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = prisma;
  }

  /**
   * Get all active rules, ordered by priority (highest first)
   */
  async getActiveRules(options?: {
    ruleType?: string;
    categoryId?: number;
    employeeId?: number;
  }): Promise<any[]> {
    const where: any = {
      isActive: true,
    };

    if (options?.ruleType) {
      where.ruleType = options.ruleType;
    }

    if (options?.categoryId) {
      where.categoryId = options.categoryId;
    }

    return await this.prisma.rule.findMany({
      where,
      include: {
        conditions: {
          orderBy: { displayOrder: 'asc' },
        },
        actions: {
          orderBy: { displayOrder: 'asc' },
        },
        category: true,
      },
      orderBy: { priority: 'desc' },
    });
  }

  /**
   * Evaluate a single rule against the provided context
   */
  async evaluateRule(
    rule: any,
    context: RuleEvaluationContext
  ): Promise<RuleEvaluationResult> {
    const startTime = Date.now();

    try {
      // Get conditions for this rule
      const conditions = rule.conditions || [];

      // Check if all conditions match
      const matchedConditions: RuleCondition[] = [];
      let allConditionsMatch = true;

      for (const condition of conditions) {
        const conditionMatches = await this.evaluateCondition(condition, context);
        if (conditionMatches) {
          matchedConditions.push(condition);
        } else {
          // Check if this is an AND condition (all must match)
          if (!condition.logicalOperator || condition.logicalOperator === 'AND') {
            allConditionsMatch = false;
            break;
          }
        }
      }

      const result: RuleEvaluationResult = {
        ruleId: rule.id,
        ruleName: rule.name,
        matched: allConditionsMatch,
        matchedConditions: matchedConditions.length > 0 ? matchedConditions as any : undefined,
        executionTime: Date.now() - startTime,
      };

      // If rule matched, execute actions
      if (allConditionsMatch) {
        const actions = rule.actions || [];
        const executedActions: ExecutedAction[] = [];

        for (const action of actions) {
          try {
            const executed = await this.executeAction(action, context);
            executedActions.push(executed);
          } catch (error) {
            console.error(`Error executing action:`, error);
          }
        }

        result.executedActions = executedActions as any;
      }

      return result;
    } catch (error) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        matched: false,
        executionTime: Date.now() - startTime,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Evaluate all active rules against the provided context
   */
  async evaluateAllRules(
    context: RuleEvaluationContext,
    options?: BatchRuleEvaluationOptions
  ): Promise<RuleEvaluationSummary> {
    const startTime = Date.now();

    // Get relevant rules
    const rules = await this.getActiveRules({
      ruleType: options?.ruleType,
      categoryId: options?.categoryId,
    });

    const results: RuleEvaluationResult[] = [];
    let matchedCount = 0;
    let failedCount = 0;

    for (const rule of rules) {
      try {
        const result = await this.evaluateRule(rule, context);
        results.push(result);

        if (result.matched) {
          matchedCount++;
        }
      } catch (error) {
        failedCount++;
        console.error(`Error evaluating rule ${rule.id}:`, error);
      }
    }

    return {
      totalRulesEvaluated: rules.length,
      matchedRules: matchedCount,
      failedRules: failedCount,
      executionDuration: Date.now() - startTime,
      results,
    };
  }

  /**
   * Evaluate rules for a specific employee
   */
  async evaluateRulesForEmployee(
    employeeId: number,
    context: RuleEvaluationContext,
    options?: BatchRuleEvaluationOptions
  ): Promise<RuleEvaluationSummary> {
    // Add employee to context if not present
    const enhancedContext = {
      ...context,
      employeeId,
    };

    return await this.evaluateAllRules(enhancedContext, options);
  }

  /**
   * Execute rules for multiple entities in batch
   */
  async executeRulesBatch(
    entityIds: number[],
    entityType: string,
    ruleType: string,
    contextProvider: (entityId: number) => Promise<RuleEvaluationContext>
  ): Promise<RuleExecutionLog[]> {
    const logs: RuleExecutionLog[] = [];
    const batchId = `batch_${Date.now()}`;

    // Get relevant rules
    const rules = await this.getActiveRules({ ruleType });

    for (const entityId of entityIds) {
      try {
        // Get context for this entity
        const context = await contextProvider(entityId);
        context.entityId = entityId;

        // Evaluate all rules
        const summary = await this.evaluateAllRules(context, { ruleType });

        // Log execution
        for (const result of summary.results) {
          if (result.matched) {
            await this.logExecution({
              ruleId: result.ruleId,
              employeeId: context.employeeId,
              entityType,
              entityId,
              triggerSource: 'batch_job',
              inputData: context as any,
              outputData: result as any,
              matchedConditions: result.matchedConditions as any,
              executedActions: result.executedActions as any,
              status: 'success',
              batchId,
              executedBy: 'system',
            });
          }
        }
      } catch (error) {
        console.error(`Error processing entity ${entityId}:`, error);
      }
    }

    return logs;
  }

  /**
   * Evaluate a single condition against the context
   */
  private async evaluateCondition(
    condition: RuleCondition,
    context: RuleEvaluationContext
  ): Promise<boolean> {
    try {
      // Get the field value from context
      const fieldValue = this.getFieldValue(context, condition.field);

      // Parse the value to compare against
      const compareValue = this.parseValue(condition.value, condition.valueType);

      // Compare based on operator
      return this.compareValues(fieldValue, condition.operator, compareValue);
    } catch (error) {
      console.error(`Error evaluating condition:`, error);
      return false;
    }
  }

  /**
   * Execute a single action
   */
  private async executeAction(
    action: RuleAction,
    context: RuleEvaluationContext
  ): Promise<ExecutedAction> {
    const executed: ExecutedAction = {
      type: action.actionType as ActionType,
      amount: 0,
      description: '',
      originalAction: action as any,
    };

    switch (action.actionType) {
      case 'set':
        executed.component = action.targetField;
        executed.amount = this.calculateActionValue(action, context);
        executed.description = `Set ${action.targetField} to ${executed.amount}`;
        break;

      case 'add':
        executed.component = action.targetField;
        executed.amount = this.calculateActionValue(action, context);
        executed.description = `Add ${executed.amount} to ${action.targetField}`;
        break;

      case 'subtract':
        executed.component = action.targetField;
        executed.amount = this.calculateActionValue(action, context);
        executed.description = `Subtract ${executed.amount} from ${action.targetField}`;
        break;

      case 'multiply':
        executed.component = action.targetField;
        executed.amount = this.calculateActionValue(action, context);
        executed.description = `Multiply ${action.targetField} by ${executed.amount}`;
        break;

      case 'divide':
        executed.component = action.targetField;
        executed.amount = this.calculateActionValue(action, context);
        executed.description = `Divide ${action.targetField} by ${executed.amount}`;
        break;

      case 'sendNotification':
        executed.description = `Send notification using template: ${action.notificationTemplate}`;
        break;

      case 'approve':
        executed.description = `Approve ${action.targetField || 'entity'}`;
        break;

      case 'reject':
        executed.description = `Reject ${action.targetField || 'entity'}`;
        break;

      case 'calculate':
        executed.component = action.targetField;
        executed.amount = this.evaluateFormula(action.formula || '', context);
        executed.description = `Calculate ${action.targetField} using formula`;
        break;

      default:
        executed.description = `Unknown action type: ${action.actionType}`;
    }

    return executed;
  }

  /**
   * Get field value from context using dot notation
   */
  private getFieldValue(context: RuleEvaluationContext, field: string): any {
    const parts = field.split('.');
    let value = context;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Parse value based on type
   */
  private parseValue(value: string, valueType: string): any {
    try {
      switch (valueType) {
        case 'number':
          return parseFloat(value);
        case 'boolean':
          return value.toLowerCase() === 'true';
        case 'json':
          return JSON.parse(value);
        case 'list':
          return JSON.parse(value);
        case 'date':
          return new Date(value);
        default:
          return value;
      }
    } catch (error) {
      return value;
    }
  }

  /**
   * Compare values based on operator
   */
  private compareValues(
    fieldValue: any,
    operator: ConditionOperator,
    compareValue: any
  ): boolean {
    switch (operator) {
      case 'eq':
        return fieldValue === compareValue;
      case 'ne':
        return fieldValue !== compareValue;
      case 'gt':
        return fieldValue > compareValue;
      case 'lt':
        return fieldValue < compareValue;
      case 'gte':
        return fieldValue >= compareValue;
      case 'lte':
        return fieldValue <= compareValue;
      case 'contains':
        return typeof fieldValue === 'string' && fieldValue.includes(compareValue);
      case 'notContains':
        return typeof fieldValue === 'string' && !fieldValue.includes(compareValue);
      case 'startsWith':
        return typeof fieldValue === 'string' && fieldValue.startsWith(compareValue);
      case 'endsWith':
        return typeof fieldValue === 'string' && fieldValue.endsWith(compareValue);
      case 'in':
        return Array.isArray(compareValue) && compareValue.includes(fieldValue);
      case 'notIn':
        return Array.isArray(compareValue) && !compareValue.includes(fieldValue);
      case 'between':
        return (
          Array.isArray(compareValue) &&
          compareValue.length === 2 &&
          fieldValue >= compareValue[0] &&
          fieldValue <= compareValue[1]
        );
      default:
        return false;
    }
  }

  /**
   * Calculate action value based on action type
   */
  private calculateActionValue(action: RuleAction, context: RuleEvaluationContext): number {
    // Handle percentage-based actions
    if (action.percent) {
      const baseValue = this.getFieldValue(context, action.targetField || '') || 0;
      return baseValue * (Number(action.percent) / 100);
    }

    // Handle fixed amount
    if (action.amount) {
      return Number(action.amount);
    }

    // Handle formula
    if (action.formula) {
      return this.evaluateFormula(action.formula, context);
    }

    return 0;
  }

  /**
   * Evaluate a simple formula
   */
  private evaluateFormula(formula: string, context: RuleEvaluationContext): number {
    try {
      // Simple formula evaluation - replace field references with values
      let evaluatedFormula = formula;

      // Replace field references (basic implementation)
      const fieldRegex = /\{([^}]+)\}/g;
      evaluatedFormula = formula.replace(fieldRegex, (_, fieldPath) => {
        const value = this.getFieldValue(context, fieldPath);
        return value !== undefined ? String(value) : '0';
      });

      // Safe evaluation of mathematical expressions
      // Only allow numbers and basic operators
      const sanitized = evaluatedFormula.replace(/[^0-9+\-*/().\s]/g, '');
      return Function(`"use strict"; return (${sanitized})`)();
    } catch (error) {
      console.error(`Error evaluating formula: ${formula}`, error);
      return 0;
    }
  }

  /**
   * Log rule execution for audit trail
   */
  private async logExecution(data: {
    ruleId: number;
    employeeId?: number;
    entityType?: string;
    entityId?: number;
    triggerSource?: string;
    inputData: any;
    outputData: any;
    matchedConditions?: any;
    executedActions?: any;
    status: string;
    batchId?: string;
    executedBy?: string;
  }): Promise<void> {
    try {
      await this.prisma.ruleExecutionLog.create({
        data: {
          ruleId: data.ruleId,
          employeeId: data.employeeId,
          entityType: data.entityType,
          entityId: data.entityId,
          triggerSource: data.triggerSource,
          inputData: data.inputData,
          outputData: data.outputData,
          matchedConditions: data.matchedConditions,
          executedActions: data.executedActions,
          status: data.status,
          batchId: data.batchId,
          executedBy: data.executedBy,
        },
      });
    } catch (error) {
      console.error('Error logging execution:', error);
    }
  }
}

// Export singleton instance
export const ruleEngineService = new RuleEngineService();
export default ruleEngineService;
