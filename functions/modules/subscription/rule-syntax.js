// Split only at the current expression level. Logical payloads and quoted/escaped
// regex commas must survive the INI -> model -> client round trip.
export function splitRuleFields(text) {
    const fields = [];
    let depth = 0;
    let quote = '';
    let escaped = false;
    let start = 0;
    const input = String(text).trim();
    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (quote) {
            if (char === quote) quote = '';
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === '(') depth++;
        if (char === ')' && --depth < 0) throw new Error('Invalid rule: unbalanced parentheses');
        if (char === ',' && depth === 0) {
            fields.push(input.slice(start, i).trim());
            start = i + 1;
        }
    }
    if (depth || quote || escaped) throw new Error('Invalid rule: unterminated expression');
    fields.push(input.slice(start).trim());
    return fields;
}

const LOGIC = new Set(['AND', 'OR', 'NOT']);

export function validateLogicalPayload(type, value) {
    if (!LOGIC.has(String(type).toUpperCase())) return;
    if (!value.startsWith('(') || !value.endsWith(')'))
        throw new Error('Invalid logical rule payload');
    const terms = splitRuleFields(value.slice(1, -1));
    if ((type.toUpperCase() === 'NOT' && terms.length !== 1) || terms.some((term) => !term)) {
        throw new Error('Invalid logical rule operands');
    }
    for (const term of terms) {
        if (!term.startsWith('(') || !term.endsWith(')'))
            throw new Error('Invalid logical rule operand');
        const condition = splitRuleFields(term.slice(1, -1));
        if (condition.length !== 2 || !condition.every(Boolean))
            throw new Error('Invalid logical rule condition');
        validateLogicalPayload(condition[0], condition[1]);
    }
}

export function parseRoutingRule(line) {
    const parts = splitRuleFields(line);
    const type = (parts[0] || '').toLowerCase();
    const terminal = type === 'match' || type === 'final';
    const policyIndex = terminal ? 1 : 2;
    if (!type || !parts[policyIndex] || (!terminal && !parts[1]))
        throw new Error('Invalid rule: missing value or policy');
    validateLogicalPayload(type, terminal ? '' : parts[1]);
    return {
        type,
        value: terminal ? '' : parts[1],
        policy: parts[policyIndex],
        extras: parts.slice(policyIndex + 1),
    };
}

export function formatRoutingRule(rule, value = rule.value) {
    const type = String(rule.type).toUpperCase();
    if (type === 'MATCH' || type === 'FINAL')
        return ['MATCH', rule.policy, ...(rule.extras || [])].join(',');
    validateLogicalPayload(type, String(value || ''));
    return [type, value, rule.policy, ...(rule.extras || [])].join(',');
}

export function assertLogicalRuleSupport(model, target) {
    if (target === 'clash') return;
    if (model.rules.some((rule) => LOGIC.has(rule.type.toUpperCase()))) {
        throw new Error(
            `Logical rules are not implemented for target ${target}; use a scoped Windows rule`
        );
    }
}
