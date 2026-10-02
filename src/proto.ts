/**
 * The protobuf boundary, for solving a model somewhere other than this WASM —
 * native OR-Tools, say, which reads the same CpModelProto bytes.
 *
 *   import { toBinary, CpModelProtoSchema } from 'cpsat-js/proto';
 *   const bytes = toBinary(CpModelProtoSchema, model.toProto());
 *
 * The protobuf runtime is re-exported with the schemas so a caller encodes with
 * the same @bufbuild/protobuf instance the schemas were generated against.
 */
export { create, toBinary, fromBinary } from '@bufbuild/protobuf';
export { CpModelProtoSchema, CpSolverResponseSchema } from './generated/cp_model_pb.js';
export type { CpModelProto, CpSolverResponse } from './generated/cp_model_pb.js';
export { SatParametersSchema } from './generated/sat_parameters_pb.js';
export type { SatParameters } from './generated/sat_parameters_pb.js';
