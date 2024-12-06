module.exports = {
    parser: '@babel/eslint-parser',
    plugins: ['prettier'],
    rules: {
        'prettier/prettier': 'error',
    },
    env: {
        browser: true,
        node: true,
    },
};
