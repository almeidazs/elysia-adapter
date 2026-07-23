import { type ASTNode, GraphQLError, GraphQLScalarType } from 'graphql';

import { Upload } from './Upload';

/**
 * GraphQL scalar implementation for multipart file uploads.
 */
export const GraphQLUpload = new GraphQLScalarType({
	name: 'Upload',
	description: 'The `Upload` scalar type represents a file upload.',
	parseValue(value: unknown) {
		if (value instanceof Upload) return value.promise;
		throw new GraphQLError('Upload value invalid.');
	},
	parseLiteral(node: ASTNode | ASTNode[]) {
		throw new GraphQLError('Upload literal unsupported.', { nodes: node });
	},
	serialize() {
		throw new GraphQLError('Upload serialization unsupported.');
	},
});
