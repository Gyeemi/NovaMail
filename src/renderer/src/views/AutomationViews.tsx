/**
 * Novamail - rules (filters) and signatures.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Rule, RuleAction, RuleCondition, Signature } from '@shared/types'
import { api, errorMessage } from '../bridge'
import { useApp } from '../state/AppProvider'
import { Icon } from '../components/icons'
import { Button, Chip, EmptyState, Field, IconButton, Modal, Spinner } from '../components/ui'

/* -------------------------------------------------------------------- rules */

export function RulesView(): ReactNode {
  const { state, actions } = useApp()
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Rule | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRules(await api.rules.list())
    } catch (error) {
      actions.pushToast({ tone: 'error', title: 'Rules could not be loaded', description: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }, [actions])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="panel" style={{ flex: 1 }} aria-label="Rules and filters">
      <div className="list-toolbar">
        <div className="list-title">Rules</div>
        <Button
          variant="primary"
          icon="plus"
          onClick={() =>
            setEditing({
              id: '',
              accountId: null,
              name: '',
              enabled: true,
              matchAll: true,
              conditions: [{ field: 'from', operator: 'contains', value: '' }],
              actions: [{ type: 'label', value: '' }],
              stopProcessing: false,
              createdAt: new Date().toISOString(),
              matchCount: 0
            })
          }
        >
          New rule
        </Button>
      </div>

      <div className="list-scroll" style={{ padding: 16 }}>
        {loading ? <Spinner label="Loading rules" /> : null}
        {!loading && rules.length === 0 ? (
          <EmptyState
            icon="filter"
            title="No rules yet"
            description="Rules file new mail automatically: move newsletters to a folder, label invoices, or star messages from your manager."
          />
        ) : null}
        {rules.map((rule) => (
          <div key={rule.id} className="settings-group" style={{ marginBottom: 12 }}>
            <div className="row">
              <strong>{rule.name || 'Untitled rule'}</strong>
              <Chip tone={rule.enabled ? 'success' : 'default'}>{rule.enabled ? 'On' : 'Off'}</Chip>
              <Chip>{rule.matchCount} matched</Chip>
              <span className="spacer" />
              <Button size="sm" onClick={() => setEditing(rule)}>
                Edit
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  await api.rules.save({ ...rule, enabled: !rule.enabled })
                  await load()
                }}
              >
                {rule.enabled ? 'Disable' : 'Enable'}
              </Button>
              <IconButton
                icon="trash"
                label={`Delete ${rule.name}`}
                onClick={async () => {
                  await api.rules.remove(rule.id)
                  await load()
                }}
              />
            </div>
            <div className="small muted">
              If {rule.matchAll ? 'all' : 'any'} of: {rule.conditions.map((condition) => `${condition.field} ${condition.operator} “${condition.value}”`).join(rule.matchAll ? ' and ' : ' or ')}
            </div>
            <div className="small muted">
              Then: {rule.actions.map((action) => `${action.type}${action.value ? ` ${action.value}` : ''}`).join(', ')}
            </div>
          </div>
        ))}
      </div>

      {editing ? (
        <RuleEditor
          rule={editing}
          accounts={state.accounts}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
          }}
        />
      ) : null}
    </section>
  )
}

function RuleEditor({
  rule,
  accounts,
  onClose,
  onSaved
}: {
  rule: Rule
  accounts: { id: string; email: string }[]
  onClose: () => void
  onSaved: () => void
}): ReactNode {
  const [draft, setDraft] = useState<Rule>(rule)
  const [testCount, setTestCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const updateCondition = (index: number, patch: Partial<RuleCondition>): void => {
    const conditions = [...draft.conditions]
    conditions[index] = { ...conditions[index]!, ...patch }
    setDraft({ ...draft, conditions })
  }

  const updateAction = (index: number, patch: Partial<RuleAction>): void => {
    const actions = [...draft.actions]
    actions[index] = { ...actions[index]!, ...patch }
    setDraft({ ...draft, actions })
  }

  return (
    <Modal
      title={rule.id ? 'Edit rule' : 'New rule'}
      size="md"
      onClose={onClose}
      footer={
        <>
          <span className="modal__footer-note">
            {testCount !== null ? `${testCount} message(s) in the current inbox would match.` : 'Rules run when new mail arrives.'}
          </span>
          <Button
            onClick={async () => {
              try {
                setTestCount(await api.rules.test({ rule: draft, limit: 100 }))
              } catch (testError) {
                setError(errorMessage(testError))
              }
            }}
          >
            Test
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              if (!draft.name.trim()) {
                setError('Give the rule a name so you recognise it later.')
                return
              }
              if (draft.conditions.some((condition) => !condition.value.trim())) {
                setError('Every condition needs a value.')
                return
              }
              try {
                await api.rules.save(draft)
                onSaved()
              } catch (saveError) {
                setError(errorMessage(saveError))
              }
            }}
          >
            Save rule
          </Button>
        </>
      }
    >
      <div className="stack">
        {error ? <span className="field__error">{error}</span> : null}
        <Field label="Rule name">
          <input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </Field>
        <Field label="Applies to" hint="Leave on “All accounts” to run for every mailbox.">
          <select
            className="select"
            value={draft.accountId ?? ''}
            onChange={(event) => setDraft({ ...draft, accountId: event.target.value || null })}
          >
            <option value="">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.email}
              </option>
            ))}
          </select>
        </Field>

        <div className="row">
          <strong className="small">Conditions</strong>
          <span className="spacer" />
          <label className="row small" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={draft.matchAll}
              onChange={(event) => setDraft({ ...draft, matchAll: event.target.checked })}
            />
            Match all (not any)
          </label>
        </div>

        {draft.conditions.map((condition, index) => (
          <div key={index} className="row" style={{ gap: 6 }}>
            <select
              className="select"
              value={condition.field}
              onChange={(event) => updateCondition(index, { field: event.target.value as RuleCondition['field'] })}
              aria-label="Field"
              style={{ maxWidth: 150 }}
            >
              <option value="from">From</option>
              <option value="to">To</option>
              <option value="subject">Subject</option>
              <option value="body">Message text</option>
              <option value="hasAttachment">Has attachment</option>
              <option value="account">Account</option>
            </select>
            <select
              className="select"
              value={condition.operator}
              onChange={(event) => updateCondition(index, { operator: event.target.value as RuleCondition['operator'] })}
              aria-label="Operator"
              style={{ maxWidth: 150 }}
            >
              <option value="contains">contains</option>
              <option value="notContains">does not contain</option>
              <option value="equals">equals</option>
              <option value="matches">matches (regular expression)</option>
            </select>
            <input
              className="input"
              value={condition.value}
              onChange={(event) => updateCondition(index, { value: event.target.value })}
              aria-label="Value"
              placeholder={condition.field === 'hasAttachment' ? 'true' : 'value'}
            />
            <IconButton
              icon="trash"
              label="Remove condition"
              onClick={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, position) => position !== index) })}
            />
          </div>
        ))}
        <Button
          size="sm"
          icon="plus"
          onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, { field: 'subject', operator: 'contains', value: '' }] })}
        >
          Add condition
        </Button>

        <div className="divider" />
        <strong className="small">Actions</strong>
        {draft.actions.map((action, index) => (
          <div key={index} className="row" style={{ gap: 6 }}>
            <select
              className="select"
              value={action.type}
              onChange={(event) => updateAction(index, { type: event.target.value as RuleAction['type'] })}
              aria-label="Action"
              style={{ maxWidth: 170 }}
            >
              <option value="move">Move to folder</option>
              <option value="label">Add label</option>
              <option value="markRead">Mark as read</option>
              <option value="star">Star</option>
              <option value="delete">Move to trash</option>
              <option value="forward">Forward to</option>
            </select>
            <input
              className="input"
              value={action.value}
              onChange={(event) => updateAction(index, { value: event.target.value })}
              aria-label="Action value"
              placeholder="Folder name, label or address"
              disabled={action.type === 'markRead' || action.type === 'star' || action.type === 'delete'}
            />
            <IconButton
              icon="trash"
              label="Remove action"
              onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, position) => position !== index) })}
            />
          </div>
        ))}
        <Button
          size="sm"
          icon="plus"
          onClick={() => setDraft({ ...draft, actions: [...draft.actions, { type: 'label', value: '' }] })}
        >
          Add action
        </Button>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={draft.stopProcessing}
            onChange={(event) => setDraft({ ...draft, stopProcessing: event.target.checked })}
          />
          <span className="checkbox-row__text">
            <strong>Stop after this rule</strong>
            <span>Later rules are skipped when this one matches.</span>
          </span>
        </label>
      </div>
    </Modal>
  )
}

/* --------------------------------------------------------------- signatures */

export function SignaturesView(): ReactNode {
  const { state, actions } = useApp()
  const [signatures, setSignatures] = useState<Signature[]>([])
  const [editing, setEditing] = useState<Signature | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSignatures(await api.signatures.list())
    } catch (error) {
      actions.pushToast({ tone: 'error', title: 'Signatures could not be loaded', description: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }, [actions])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="panel" style={{ flex: 1 }} aria-label="Signatures">
      <div className="list-toolbar">
        <div className="list-title">Signatures</div>
        <Button
          variant="primary"
          icon="plus"
          onClick={() =>
            setEditing({
              id: '',
              accountId: state.accounts[0]?.id ?? null,
              name: '',
              html: '',
              isDefault: signatures.length === 0
            })
          }
        >
          New signature
        </Button>
      </div>
      <div className="list-scroll" style={{ padding: 16 }}>
        {loading ? <Spinner label="Loading signatures" /> : null}
        {!loading && signatures.length === 0 ? (
          <EmptyState
            icon="compose"
            title="No signatures yet"
            description="Create one or more signatures, then pick the right one while writing a message."
          />
        ) : null}
        {signatures.map((signature) => (
          <div key={signature.id} className="settings-group" style={{ marginBottom: 12 }}>
            <div className="row">
              <strong>{signature.name}</strong>
              {signature.isDefault ? <Chip tone="accent">Default</Chip> : null}
              <Chip>{state.accounts.find((account) => account.id === signature.accountId)?.email ?? 'All accounts'}</Chip>
              <span className="spacer" />
              <Button size="sm" onClick={() => setEditing(signature)}>
                Edit
              </Button>
              <IconButton
                icon="trash"
                label={`Delete ${signature.name}`}
                onClick={async () => {
                  await api.signatures.remove(signature.id)
                  await load()
                }}
              />
            </div>
            <div
              className="small"
              style={{ borderLeft: '3px solid var(--nm-border)', paddingLeft: 10 }}
              dangerouslySetInnerHTML={{ __html: sanitizeSignature(signature.html) }}
            />
          </div>
        ))}
      </div>

      {editing ? (
        <Modal
          title={editing.id ? 'Edit signature' : 'New signature'}
          size="md"
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={async () => {
                  if (!editing.name.trim()) {
                    actions.pushToast({ tone: 'warning', title: 'Give the signature a name' })
                    return
                  }
                  await api.signatures.save(editing)
                  setEditing(null)
                  await load()
                  actions.pushToast({ tone: 'success', title: 'Signature saved' })
                }}
              >
                Save
              </Button>
            </>
          }
        >
          <div className="stack">
            <Field label="Name">
              <input className="input" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
            </Field>
            <Field label="Account">
              <select
                className="select"
                value={editing.accountId ?? ''}
                onChange={(event) => setEditing({ ...editing, accountId: event.target.value || null })}
              >
                <option value="">All accounts</option>
                {state.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.email}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Signature" hint="Simple HTML is allowed: bold, italic, links, line breaks.">
              <textarea
                className="textarea mono"
                rows={8}
                value={editing.html}
                onChange={(event) => setEditing({ ...editing, html: event.target.value })}
              />
            </Field>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={editing.isDefault}
                onChange={(event) => setEditing({ ...editing, isDefault: event.target.checked })}
              />
              <span className="checkbox-row__text">
                <strong>Use by default</strong>
                <span>Added automatically to new messages for this account.</span>
              </span>
            </label>
          </div>
        </Modal>
      ) : null}
    </section>
  )
}

/** Signatures are authored by the user but still never trusted as raw HTML. */
function sanitizeSignature(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/javascript:/gi, '')
}

export type { Icon }
