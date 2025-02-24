const path = require('path');
const webpack = require('webpack');

const HtmlWebpackPlugin = require('html-webpack-plugin');
const artifact = require('./package.json');
const CopyWebpackPlugin = require('copy-webpack-plugin');
//const ESLintPlugin = require('eslint-webpack-plugin');

const fileName = `${artifact.name}-${artifact.version.slice(0, 3)}`;

module.exports = (env, argv) => ({
    entry: {
        [fileName]: './src/index.js',
    },
    output: {
        filename: '[name].[fullhash].bundle.js',
        path: path.resolve(__dirname, 'dist'),
        publicPath: '',
    },
    devServer: {
        historyApiFallback: true,
        open: true,
        compress: true,
        port: 8080,
    },
    module: {
        rules: [
            {
                test: /\.(css)$/,
                use: [
                    { loader: 'style-loader' },
                    { loader: 'css-loader', options: { sourceMap: true, importLoaders: 1 } }
                ],
            },
            {
                test: /\.js$/,
                exclude: /(node_modules)/,
                use: ['babel-loader'],
            },
            {
                test: /\.(?:ico|gif|png|jpg|jpeg|webp|svg|stl)$/i,
                loader: 'file-loader',
                options: {
                    name: '[path][name].[ext]',
                    context: 'src', // prevent display of src/ in filename
                },
            },
            {
                test: /\.(woff(2)?|eot|ttf|otf|)$/,
                loader: 'url-loader',
                options: {
                    limit: 8192,
                    name: '[path][name].[ext]',
                    context: 'src', // prevent display of src/ in filename
                },
            },
        ],
    },
    plugins: [
        new webpack.HotModuleReplacementPlugin(),
        /*new ESLintPlugin(),*/
        new CopyWebpackPlugin({
            patterns: [{ from: path.resolve(__dirname, 'public'), to:  path.resolve(__dirname, 'dist') }],
        }),
        new HtmlWebpackPlugin({
            title: 'Learning TSL: The river.',
            favicon: path.resolve(__dirname, 'public/favicon.png'),
            template: path.resolve(__dirname, 'src/template.html'), // template file
            filename: 'index.html', // output file
        }),
    ],
    devtool: 'eval-source-map',
    performance: {
        hints: false,
        maxEntrypointSize: 512000,
        maxAssetSize: 512000,
    },
});
