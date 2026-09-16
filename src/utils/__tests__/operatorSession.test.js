import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearOperatorSession, getOperatorSession, getOperatorSessionHeaders, setOperatorSession, subscribeOperatorSession } from '../../services/operatorSession.js'

const makeSession = () => ({ token: 'a'.repeat(64), id: 'b'.repeat(64), expiresAt: new Date(Date.now() + 60000).toISOString() })
afterEach(() => { clearOperatorSession(); vi.useRealTimers() })

describe('ephemeral browser operator session', () => {
  it('stores the credential only in memory and yields both headers', () => {
    const session = makeSession()
    setOperatorSession(session, { accountId: 'account', operatorId: 'seller' })
    expect(getOperatorSessionHeaders()).toEqual({ 'X-Operator-Session': session.token, 'X-Operator-Id': 'seller' })
    expect(getOperatorSession()).toMatchObject({ accountId: 'account', operatorId: 'seller' })
    expect(Object.isFrozen(getOperatorSession())).toBe(true)
  })
  it('notifies consumers and immediately removes data access on expiry', () => {
    vi.useFakeTimers()
    const listener = vi.fn()
    const unsubscribe = subscribeOperatorSession(listener)
    setOperatorSession(makeSession(), { accountId: 'account', operatorId: 'seller' })
    vi.advanceTimersByTime(60001)
    expect(getOperatorSession()).toBeNull()
    expect(getOperatorSessionHeaders()).toEqual({})
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
  it('does not keep previous access when the next credential is malformed', () => {
    setOperatorSession(makeSession(), { accountId: 'account', operatorId: 'boss' })
    expect(() => setOperatorSession({ ...makeSession(), token: 'forged' }, { accountId: 'account', operatorId: 'seller' })).toThrow()
    expect(getOperatorSession()).toBeNull()
  })
  it('does not let the old expiry timer terminate the replacement', () => {
    vi.useFakeTimers()
    setOperatorSession(makeSession(), { accountId: 'account', operatorId: 'boss' })
    vi.advanceTimersByTime(30000)
    setOperatorSession({ ...makeSession(), token: 'c'.repeat(64), id: 'd'.repeat(64) }, { accountId: 'account', operatorId: 'seller' })
    vi.advanceTimersByTime(30001)
    expect(getOperatorSession()?.operatorId).toBe('seller')
    clearOperatorSession()
    expect(getOperatorSession()).toBeNull()
  })
})
