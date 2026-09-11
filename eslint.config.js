// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Based on the official GJS style guide configuration:
// https://gjs.guide/guides/gjs/style-guide.html

import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';

/** Globals present in any GJS runtime (helper and shell alike). */
const gjsGlobals = {
    ARGV: 'readonly',
    Debugger: 'readonly',
    GIRepositoryGType: 'readonly',
    globalThis: 'readonly',
    imports: 'readonly',
    Intl: 'readonly',
    log: 'readonly',
    logError: 'readonly',
    pkg: 'readonly',
    print: 'readonly',
    printerr: 'readonly',
    console: 'readonly',
    setTimeout: 'readonly',
    setInterval: 'readonly',
    clearTimeout: 'readonly',
    clearInterval: 'readonly',
    TextEncoder: 'readonly',
    TextDecoder: 'readonly',
};

/** Extra globals injected only inside the gnome-shell process. */
const shellGlobals = {
    ...gjsGlobals,
    global: 'readonly',
    _: 'readonly',
    C_: 'readonly',
    N_: 'readonly',
    ngettext: 'readonly',
};

const gjsRules = {
    // Possible problems
    'array-callback-return': 'error',
    'no-await-in-loop': 'error',
    'no-constant-binary-expression': 'error',
    'no-constructor-return': 'error',
    'no-new-native-nonconstructor': 'error',
    'no-promise-executor-return': 'error',
    'no-self-compare': 'error',
    'no-template-curly-in-string': 'error',
    'no-unmodified-loop-condition': 'error',
    'no-unreachable-loop': 'error',
    'no-unused-private-class-members': 'error',
    'no-use-before-define': ['error', {
        functions: false,
        classes: true,
        variables: true,
        allowNamedExports: true,
    }],

    // Suggestions
    'block-scoped-var': 'error',
    'complexity': 'warn',
    'consistent-return': 'error',
    'default-param-last': 'error',
    'eqeqeq': 'error',
    'no-array-constructor': 'error',
    'no-caller': 'error',
    'no-extend-native': 'error',
    'no-extra-bind': 'error',
    'no-extra-label': 'error',
    'no-iterator': 'error',
    'no-label-var': 'error',
    'no-loop-func': 'error',
    'no-multi-assign': 'warn',
    'no-new-wrappers': 'error',
    'no-proto': 'error',
    'no-shadow': 'warn',
    'no-unused-vars': ['error', {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
    }],
    'no-var': 'error',
    'prefer-const': 'error',
    'unicode-bom': 'error',

    // GJS restrictions
    'no-restricted-globals': ['error',
        {name: 'Debugger', message: 'Internal use only'},
        {name: 'GIRepositoryGType', message: 'Internal use only'},
        {name: 'log', message: 'Use console.log()'},
        {name: 'logError', message: 'Use console.warn() or console.error()'},
    ],
    'no-restricted-properties': ['error',
        {object: 'imports', property: 'format', message: 'Use template strings'},
        {object: 'pkg', property: 'initFormat', message: 'Use template strings'},
        {object: 'Lang', property: 'copyProperties', message: 'Use Object.assign()'},
        {object: 'Lang', property: 'bind', message: 'Use arrow notation or Function.prototype.bind()'},
        {object: 'Lang', property: 'Class', message: 'Use ES6 classes'},
        {object: 'Object', property: 'defineProperty', message: 'Use Object.assign() or spread syntax'},
    ],
    'no-restricted-syntax': ['error',
        {
            selector: 'MethodDefinition[key.name="_init"] CallExpression[arguments.length<=1][callee.object.type="Super"][callee.property.name="_init"]',
            message: 'Use constructor() and super()',
        },
        {
            selector: 'CallExpression[callee.name="structuredClone"]',
            message: 'structuredClone() does not exist in GJS 1.80 (GNOME 46)',
        },
    ],
};

export default [
    {ignores: ['node_modules/', 'build/', 'coverage/']},
    js.configs.recommended,
    jsdoc.configs['flat/recommended'],
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: gjsGlobals,
        },
        rules: {
            ...gjsRules,
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param-description': 'off',
            'jsdoc/require-returns-description': 'off',
            'jsdoc/tag-lines': 'off',
        },
    },
    {
        // Code that runs inside the gnome-shell process.
        files: ['src/extension.js', 'src/prefs.js', 'src/lib/**/*.js'],
        languageOptions: {globals: shellGlobals},
    },
    {
        // Node-only tooling and tests.
        // Tests document themselves through their names; JSDoc on a fixture
        // builder is noise, not documentation.
        files: ['tests/**/*.js', '*.config.js'],
        languageOptions: {
            globals: {
                process: 'readonly',
                console: 'readonly',
                URL: 'readonly',
            },
        },
        rules: {
            'no-restricted-globals': 'off',
            'jsdoc/require-param': 'off',
            'jsdoc/require-param-type': 'off',
            'jsdoc/require-returns': 'off',
            'jsdoc/require-returns-type': 'off',
        },
    },
];
