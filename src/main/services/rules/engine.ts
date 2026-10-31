/**
 * Novamail - rules / filters engine (pure, unit tested).
 *
 * Rules are evaluated against a snapshot of the message headers so the decision
 * never depends on network state. The caller applies the returned actions.
 */
import type { Rule, RuleAction, RuleCondition } from '@shared/types'

export interface RuleTarget {
  accountId: string
  accountEmail: string
  fromAddress: string
  fromName: string
  toAddresses: string[]
  subject: string
  body: string
  hasAttachment: boolean
}

export function matchesCondition(condition: RuleCondition, target: RuleTarget): boolean {
  const { field, operator, value } = condition
  const needle = value.toLowerCase()

  let haystack = ''
  let booleanField: boolean | null = null

  switch (field) {
    case 'from':
      haystack = `${target.fromName} ${target.fromAddress}`
      break
    case 'to':
      haystack = target.toAddresses.join(' ')
      break
    case 'subject':
      haystack = target.subject
      break
    case 'body':
      haystack = target.body
      break
    case 'account':
      haystack = `${target.accountEmail} ${target.accountId}`
      break
    case 'hasAttachment':
      booleanField = target.hasAttachment
      break
    default:
      return false
  }

  if (booleanField !== null) {
    const expected = /^(true|yes|1)$/i.test(value)
    return operator === 'notContains' || operator === 'equals' ? booleanField === expected : booleanField === expected
  }

  const normalized = haystack.toLowerCase()
  switch (operator) {
    case 'contains':
      return normalized.includes(needle)
    case 'notContains':
      return !normalized.includes(needle)
    case 'equals':
      return normalized.trim() === needle
    case 'is':
      return normalized.trim() === needle
    case 'matches':
      try {
        return new RegExp(value, 'i').test(haystack)
      } catch {
        return false
      }
    default:
      return false
  }
}

export interface RuleEvaluation {
  matched: Rule[]
  actions: RuleAction[]
  /** rules that asked to stop processing after matching */
  stop: boolean
}

export function evaluateRules(rules: Rule[], target: RuleTarget): RuleEvaluation {
  const matched: Rule[] = []
  const actions: RuleAction[] = []
  let stop = false

  for (const rule of rules) {
    if (!rule.enabled) continue
    if (rule.accountId && rule.accountId !== target.accountId) continue
    if (rule.conditions.length === 0) continue

    const results = rule.conditions.map((condition) => matchesCondition(condition, target))
    const isMatch = rule.matchAll ? results.every(Boolean) : results.some(Boolean)
    if (!isMatch) continue

    matched.push(rule)
    actions.push(...rule.actions)
    if (rule.stopProcessing) {
      stop = true
      break
    }
  }

  return { matched, actions, stop }
}

export function describeRule(rule: Rule): string {
  const conditionText = rule.conditions
    .map((condition) => {
      const fieldLabel = {
        from: 'sender',
        to: 'recipient',
        subject: 'subject',
        body: 'message text',
        hasAttachment: 'attachment',
        account: 'account'
      }[condition.field]
      return `${fieldLabel} ${condition.operator} "${condition.value}"`
    })
    .join(rule.matchAll ? ' and ' : ' or ')
  const actionText = rule.actions
    .map((action) => {
      const label = {
        move: `move to ${action.value}`,
        label: `label as ${action.value}`,
        markRead: 'mark as read',
        star: 'star',
        delete: 'delete',
        forward: `forward to ${action.value}`
      }[action.type]
      return label
    })
    .join(', ')
  return `If ${conditionText}, then ${actionText}.`
}
