import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as R from 'ramda';
import moment from 'moment';
import {
  elAggregationCount,
  elAggregationRelationsCount,
  elCount,
  elCreateIndices,
  elDeleteElements,
  elDeleteIndices,
  elHistogramCount,
  elIndex,
  elIndexElements,
  elIndexExists,
  elIndexGetAlias,
  elLoadById,
  elPaginate,
  elRebuildRelation,
  elReindexElements,
  ES_INDEX_PATTERN_SUFFIX,
  ES_MAX_PAGINATION,
  searchEngineInit
} from '../../../src/database/engine';
import {
  DEPRECATED_INDICES,
  ES_INDEX_PREFIX,
  INDEX_INTERNAL_OBJECTS,
  READ_DATA_INDICES,
  READ_ENTITIES_INDICES,
  READ_INDEX_INTERNAL_OBJECTS,
  READ_INDEX_STIX_DOMAIN_OBJECTS,
  READ_RELATIONSHIPS_INDICES,
  WRITE_PLATFORM_INDICES
} from '../../../src/database/utils';
import { utcDate } from '../../../src/utils/format';
import { ADMIN_USER, buildStandardUser, testContext, TESTING_GROUPS, TESTING_ORGS, TESTING_ROLES, TESTING_USERS } from '../../utils/testQuery';
import { BASE_TYPE_RELATION, buildRefRelationKey, ENTITY_TYPE_IDENTITY } from '../../../src/schema/general';
import { RELATION_OBJECT_LABEL, RELATION_OBJECT_MARKING } from '../../../src/schema/stixRefRelationship';
import { RELATION_USES } from '../../../src/schema/stixCoreRelationship';
import { buildAggregationRelationFilter } from '../../../src/database/middleware-loader';
import { mapCountPerEntityType, mapEdgesCountPerEntityType } from '../../utils/domainQueryHelper';

const elWhiteUser = async () => {
  const opts = { types: ['Marking-Definition'], connectionFormat: false };
  const allMarkings = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, opts);
  const ALL_TLP = allMarkings.map((a) => ({ internal_id: a.internal_id, standard_id: a.standard_id }));
  const TLP_WHITE = await elLoadById(testContext, ADMIN_USER, 'marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9');
  return buildStandardUser([{ internal_id: TLP_WHITE.internal_id, standard_id: TLP_WHITE.standard_id }], ALL_TLP);
};

const VOCABULARY_COUNT = 347;

describe('Elasticsearch configuration test', () => {
  it('should configuration correct', async () => {
    expect(searchEngineInit()).resolves.toBeTruthy();
    // check all WRITE_PLATFORM_INDICES creation
    for (let i = 0; i < WRITE_PLATFORM_INDICES.length; i += 1) {
      const indexName = WRITE_PLATFORM_INDICES[i];
      const indexExists = await elIndexExists(indexName);
      expect(indexExists).toBeTruthy();
    }
    for (let i = 0; i < DEPRECATED_INDICES.length; i += 1) {
      const indexName = DEPRECATED_INDICES[i];
      expect(await elIndexExists(indexName)).toBeFalsy();
    }
  });
  it('should get internal object index with alias', async () => {
    const internalObjectsIndexAlias = await elIndexGetAlias(READ_INDEX_INTERNAL_OBJECTS);
    // internalObjectsIndexAlias = {"test_internal_objects-000001":{"aliases":{"test_internal_objects":{}}}}
    const numberOfIndices = Object.keys(internalObjectsIndexAlias).length;
    expect(internalObjectsIndexAlias).toBeDefined();
    expect(numberOfIndices).toEqual(1);
    expect(Object.entries(internalObjectsIndexAlias)[0][0]).toEqual(`${INDEX_INTERNAL_OBJECTS}${ES_INDEX_PATTERN_SUFFIX}`);
    expect(Object.entries(internalObjectsIndexAlias)[0][1].aliases).toEqual({ [INDEX_INTERNAL_OBJECTS]: {} });
  });
});

describe('Elasticsearch document loader', () => {
  beforeAll(async () => {
    await searchEngineInit();
    await elCreateIndices(['test_index']);
  });
  afterAll(async () => {
    await elDeleteIndices(['test_index-000001']);
  });

  it('should create and retrieve document', async () => {
    // Index an element and try to retrieve the data
    const standardId = 'campaign--aae8b913-564b-405e-a9c1-5e5ea6c60259';
    const internalId = '867d03f4-be73-44f6-82d9-7d7b14df55d7';
    const documentBody = {
      internal_id: internalId,
      standard_id: standardId,
      name: 'Germany - Maze - October 2019',
      entity_type: 'Campaign',
      parent_types: ['Campaign', 'Stix-Domain-Object', 'Stix-Core-Object', 'Stix-Object', 'Basic-Object'],
    };
    const indexedData = await elIndex('test_index', documentBody);
    expect(indexedData).toEqual(documentBody);
    const documentWithIndex = R.assoc('_index', 'test_index-000001', documentBody);
    // Load by internal Id
    const opts = { type: null, indices: ['test_index'] };
    const dataThroughInternal = await elLoadById(testContext, ADMIN_USER, internalId, opts);
    expect(dataThroughInternal.standard_id).toEqual(documentWithIndex.standard_id);
    // Load by stix id
    const dataThroughStix = await elLoadById(testContext, ADMIN_USER, standardId, opts);
    expect(dataThroughStix.standard_id).toEqual(documentWithIndex.standard_id);
    // Try to delete
    await elDeleteElements(testContext, ADMIN_USER, [dataThroughStix], { forceDelete: true });
    const removedInternal = await elLoadById(testContext, ADMIN_USER, internalId, opts);
    expect(removedInternal).toBeUndefined();
  });
});

describe('Elasticsearch computation', () => {
  it('should count accurate', async () => {
    // const { endDate = null, type = null, types = null } = options;
    const malwaresCount = await elCount(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { types: ['Malware'] });
    expect(malwaresCount).toEqual(2);
  });
  it('should count accurate with date filter', async () => {
    const mostRecentMalware = await elLoadById(testContext, ADMIN_USER, 'malware--c6006dd5-31ca-45c2-8ae0-4e428e712f88');
    const malwaresCount = await elCount(testContext, ADMIN_USER, READ_ENTITIES_INDICES, {
      types: ['Malware'],
      endDate: mostRecentMalware.created_at,
    });
    expect(malwaresCount).toEqual(1);
  });
  it('should entity aggregation accurate', async () => {
    // Aggregate all stix domain by entity type, no filtering
    const malwaresAggregation = await elAggregationCount(
      testContext,
      ADMIN_USER,
      READ_DATA_INDICES,
      {
        types: ['Stix-Domain-Object'],
        field: 'entity_type'
      }
    );
    const aggregationMap = new Map(malwaresAggregation.map((i) => [i.label, i.value]));
    expect(aggregationMap.get('Malware')).toEqual(2);
    expect(aggregationMap.get('Indicator')).toEqual(3);
  });
  it('should entity aggregation with date accurate', async () => {
    const mostRecentMalware = await elLoadById(testContext, ADMIN_USER, 'malware--c6006dd5-31ca-45c2-8ae0-4e428e712f88');
    const malwaresAggregation = await elAggregationCount(
      testContext,
      ADMIN_USER,
      READ_DATA_INDICES,
      {
        types: ['Stix-Domain-Object'],
        field: 'entity_type',
        startDate: '2019-01-01T00:00:00Z',
        endDate: new Date(mostRecentMalware.created_at).toISOString(),
        filters: {
          mode: 'and',
          filters: [{ key: ['name'], values: ['Paradise Ransomware'] }],
          filterGroups: [],
        },
      }
    );
    const aggregationMap = new Map(malwaresAggregation.map((i) => [i.label, i.value]));
    expect(aggregationMap.size).toEqual(1);
    expect(aggregationMap.get('Malware')).toEqual(1);
  });
  it('should entity aggregation with relation accurate', async () => {
    // Aggregate with relation filter on marking definition TLP:RED
    const marking = await elLoadById(testContext, ADMIN_USER, 'marking-definition--78ca4366-f5b8-4764-83f7-34ce38198e27');
    const malwaresAggregation = await elAggregationCount(
      testContext,
      ADMIN_USER,
      READ_DATA_INDICES,
      {
        types: ['Stix-Domain-Object'],
        field: 'entity_type',
        filters: {
          mode: 'and',
          filters: [{ key: [buildRefRelationKey(RELATION_OBJECT_MARKING)], values: [marking.internal_id] }],
          filterGroups: [],
        },
      }
    );
    const aggregationMap = new Map(malwaresAggregation.map((i) => [i.label, i.value]));
    expect(aggregationMap.get('Malware')).toEqual(1);
    expect(aggregationMap.get('Report')).toEqual(1);
  });
  it('should relation aggregation accurate', async () => {
    const testingReport = await elLoadById(testContext, ADMIN_USER, 'report--a445d22a-db0c-4b5d-9ec8-e9ad0b6dbdd7');
    const opts = { fromId: testingReport.internal_id, toTypes: ['Stix-Domain-Object'], isTo: true };
    const distributionArgs = buildAggregationRelationFilter(['stix-ref-relationship'], opts);
    const reportRelationsAggregation = await elAggregationRelationsCount(testContext, ADMIN_USER, READ_RELATIONSHIPS_INDICES, distributionArgs);
    const aggregationMap = new Map(reportRelationsAggregation.map((i) => [i.label, i.value]));
    expect(aggregationMap.get('Indicator')).toEqual(3);
    expect(aggregationMap.get('Organization')).toEqual(3);
    expect(aggregationMap.get('Attack-Pattern')).toEqual(2);
    expect(aggregationMap.get('City')).toEqual(1);
    expect(aggregationMap.get('Country')).toEqual(1);
    expect(aggregationMap.get('Intrusion-Set')).toEqual(1);
    expect(aggregationMap.get('Malware')).toEqual(1);
    expect(aggregationMap.get('Sector')).toEqual(1);
  });
  it('should relation aggregation with date accurate', async () => {
    // "target_ref": "location--c3794ffd-0e71-4670-aa4d-978b4cbdc72c", City -> Hietzing
    // "target_ref": "malware--faa5b705-cf44-4e50-8472-29e5fec43c3c"
    const intrusionSet = await elLoadById(testContext, ADMIN_USER, 'intrusion-set--18854f55-ac7c-4634-bd9a-352dd07613b7');
    // "target_ref": "identity--c017f212-546b-4f21-999d-97d3dc558f7b", organization -> Allied Universal
    const opts = {
      fromOrToId: intrusionSet.internal_id,
      start: '2020-02-29T00:00:00Z',
      end: new Date().getTime(),
      elementWithTargetTypes: ['Stix-Domain-Object'],
    };
    const distributionArgs = buildAggregationRelationFilter(['stix-core-relationship'], opts);
    const intrusionRelationsAggregation = await elAggregationRelationsCount(testContext, ADMIN_USER, READ_RELATIONSHIPS_INDICES, distributionArgs);
    const aggregationMap = new Map(intrusionRelationsAggregation.map((i) => [i.label, i.value]));
    expect(aggregationMap.get('Campaign')).toEqual(1);
    expect(aggregationMap.get('City')).toEqual(1);
    expect(aggregationMap.get('Indicator')).toEqual(1);
    expect(aggregationMap.get('Organization')).toEqual(1);
    expect(aggregationMap.get('Malware')).toEqual(1); // Because of date filtering
  });
  it('should invalid time histogram fail', async () => {
    const histogramCount = elHistogramCount(testContext, ADMIN_USER, READ_INDEX_STIX_DOMAIN_OBJECTS, { types: ['Stix-Domain-Object'], field: 'created_at', interval: 'minute' });
    // noinspection ES6MissingAwait.toEqual(36);
    expect(histogramCount).rejects.toThrow();
  });
  it('should day histogram accurate', async () => {
    const data = await elHistogramCount(
      testContext,
      ADMIN_USER,
      READ_INDEX_STIX_DOMAIN_OBJECTS,
      { types: ['Stix-Domain-Object'], field: 'created_at', interval: 'day', startDate: '2019-09-29T00:00:00.000Z', endDate: new Date().toISOString() }
    );
    expect(data.length).toEqual(1);
    // noinspection JSUnresolvedVariable
    const storedFormat = moment(R.head(data).date)._f;
    expect(storedFormat).toEqual('YYYY-MM-DD');
    expect(R.head(data).value).toEqual(34 + TESTING_ORGS.length);
  });
  it('should month histogram accurate', async () => {
    const data = await elHistogramCount(
      testContext,
      ADMIN_USER,
      READ_INDEX_STIX_DOMAIN_OBJECTS,
      { types: ['Stix-Domain-Object'], field: 'created', interval: 'month', startDate: '2019-09-23T00:00:00.000Z', endDate: '2020-03-02T00:00:00.000Z' }
    );
    expect(data.length).toEqual(7);
    const aggregationMap = new Map(data.map((i) => [i.date, i.value]));
    expect(aggregationMap.get('2019-08')).toEqual(undefined);
    expect(aggregationMap.get('2019-09')).toEqual(2);
    expect(aggregationMap.get('2019-10')).toEqual(4);
    expect(aggregationMap.get('2019-11')).toEqual(0);
    expect(aggregationMap.get('2019-12')).toEqual(0);
    expect(aggregationMap.get('2020-01')).toEqual(1);
    expect(aggregationMap.get('2020-02')).toEqual(14);
    expect(aggregationMap.get('2020-03')).toEqual(1);
  });
  it('should year histogram accurate', async () => {
    const data = await elHistogramCount(
      testContext,
      ADMIN_USER,
      READ_DATA_INDICES,
      {
        types: ['Stix-Domain-Object'],
        field: 'created',
        interval: 'year',
        startDate: '2019-09-23T00:00:00.000Z',
        endDate: '2020-03-02T00:00:00.000Z',
      }
    );
    expect(data.length).toEqual(2);
    const aggregationMap = new Map(data.map((i) => [i.date, i.value]));
    expect(aggregationMap.get('2019')).toEqual(6);
    expect(aggregationMap.get('2020')).toEqual(16);
  });
  it('should year histogram with relation filter accurate (uses)', async () => {
    const attackPattern = await elLoadById(testContext, ADMIN_USER, 'attack-pattern--489a7797-01c3-4706-8cd1-ec56a9db3adc');
    const data = await elHistogramCount(
      testContext,
      ADMIN_USER,
      READ_ENTITIES_INDICES,
      {
        types: ['Stix-Domain-Object'],
        field: 'created',
        interval: 'year',
        startDate: '2019-09-23T00:00:00.000Z',
        endDate: '2020-03-02T00:00:00.000Z',
        filters: {
          mode: 'and',
          filters: [{ key: [buildRefRelationKey(RELATION_USES)], values: [attackPattern.internal_id] }],
          filterGroups: [],
        },
      }
    );
    expect(data.length).toEqual(1);
    const aggregationMap = new Map(data.map((i) => [i.date, i.value]));
    expect(aggregationMap.get('2019')).toEqual(1);
  });
  it('should year histogram with relation filter accurate (undefined)', async () => {
    const attackPattern = await elLoadById(testContext, ADMIN_USER, 'attack-pattern--489a7797-01c3-4706-8cd1-ec56a9db3adc');
    const data = await elHistogramCount(
      testContext,
      ADMIN_USER,
      READ_ENTITIES_INDICES,
      {
        types: ['Stix-Domain-Object'],
        field: 'created',
        interval: 'year',
        startDate: '2019-09-23T00:00:00.000Z',
        endDate: '2020-03-02T00:00:00.000Z',
        filters: {
          mode: 'and',
          filters: [{ key: [buildRefRelationKey('*')], values: [attackPattern.internal_id] }],
          filterGroups: [],
        }
      }
    );
    expect(data.length).toEqual(2);
    const aggregationMap = new Map(data.map((i) => [i.date, i.value]));
    expect(aggregationMap.get('2019')).toEqual(1);
    expect(aggregationMap.get('2020')).toEqual(1);
  });
  it('should year histogram with attribute filter accurate', async () => {
    const data = await elHistogramCount(
      testContext,
      ADMIN_USER,
      READ_ENTITIES_INDICES,
      {
        types: [ENTITY_TYPE_IDENTITY],
        field: 'created',
        interval: 'year',
        filters: {
          mode: 'and',
          filters: [{ key: ['name'], values: ['ANSSI'] }],
          filterGroups: [],
        },
      }
    );
    expect(data.length).toEqual(1);
    const aggregationMap = new Map(data.map((i) => [i.date, i.value]));
    expect(aggregationMap.get('2020')).toEqual(1);
  });
});

describe('Elasticsearch relation reconstruction', () => {
  const RELATION_ID = 'a0cfc7fc-837b-5ea0-b919-425047d4bb0d';
  const CONN_MALWARE_ID = '6fb84f02-f095-430e-87a0-394d41955eee';
  const CONN_MALWARE_ROLE = 'object-marking_from';
  const CONN_MARKING_ID = '63309927-48f6-45c2-aee0-4d92b403cee5';
  const CONN_MARKING_ROLE = 'object-marking_to';
  const buildRelationConcept = (relationshipType) => ({
    internal_id: RELATION_ID,
    base_type: BASE_TYPE_RELATION,
    entity_type: 'object-marking',
    relationship_type: relationshipType,
    connections: [
      {
        internal_id: CONN_MALWARE_ID,
        role: CONN_MALWARE_ROLE,
        types: ['Malware', 'Basic-Object', 'Stix-Object', 'Stix-Core-Object', 'Stix-Domain-Object'],
      },
      {
        internal_id: CONN_MARKING_ID,
        role: CONN_MARKING_ROLE,
        types: ['Marking-Definition', 'Basic-Object', 'Stix-Object', 'Stix-Meta-Object'],
      },
    ],
  });
  it('Relation reconstruct natural', async () => {
    const concept = buildRelationConcept('object-marking');
    const relation = elRebuildRelation(concept);
    expect(relation.fromId).toEqual(CONN_MALWARE_ID);
    expect(relation.fromRole).toEqual(CONN_MALWARE_ROLE);
    expect(relation.toId).toEqual(CONN_MARKING_ID);
    expect(relation.toRole).toEqual(CONN_MARKING_ROLE);
  });
  it('Relation reconstruct with internal_id', async () => {
    const concept = buildRelationConcept('object-marking');
    const relation = elRebuildRelation(concept);
    expect(relation.internal_id).toEqual(concept.internal_id);
    expect(relation.fromId).toEqual(CONN_MALWARE_ID);
    expect(relation.fromRole).toEqual(CONN_MALWARE_ROLE);
    expect(relation.toId).toEqual(CONN_MARKING_ID);
    expect(relation.toRole).toEqual(CONN_MARKING_ROLE);
  });
  it('Relation reconstruct with no info', async () => {
    const concept = buildRelationConcept('object-marking');
    const relation = elRebuildRelation(concept);
    expect(relation.fromId).toEqual(CONN_MALWARE_ID);
    expect(relation.toId).toEqual(CONN_MARKING_ID);
  });
  it('Relation reconstruct from reverse id', async () => {
    const concept = buildRelationConcept('object-marking');
    const relation = elRebuildRelation(concept);
    expect(relation.fromId).toEqual(CONN_MALWARE_ID);
    expect(relation.toId).toEqual(CONN_MARKING_ID);
  });
  it('Relation reconstruct from roles', async () => {
    const concept = buildRelationConcept('object-marking');
    const relation = elRebuildRelation(concept);
    expect(relation.fromId).toEqual(CONN_MALWARE_ID);
    expect(relation.toId).toEqual(CONN_MARKING_ID);
  });
});

describe('Elasticsearch pagination', () => {
  it('should entity paginate everything', async () => {
    const data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { first: ES_MAX_PAGINATION });
    expect(data).not.toBeNull();
    const entityTypeMap = mapEdgesCountPerEntityType(data);
    expect(entityTypeMap.get('Attack-Pattern')).toBe(2);
    expect(entityTypeMap.get('Campaign')).toBe(1);
    expect(entityTypeMap.get('Capability')).toBe(42);
    expect(entityTypeMap.get('Course-Of-Action')).toBe(1);
    expect(entityTypeMap.get('Credential')).toBe(1);
    expect(entityTypeMap.get('DecayRule')).toBe(4);
    expect(entityTypeMap.get('EntitySetting')).toBe(44);
    expect(entityTypeMap.get('External-Reference')).toBe(7);
    expect(entityTypeMap.get('StixFile')).toBe(1);
    expect(entityTypeMap.get('Group')).toBe(TESTING_GROUPS.length + 3);
    expect(entityTypeMap.get('Individual')).toBe(1);
    expect(entityTypeMap.get('Sector')).toBe(3);
    expect(entityTypeMap.get('Organization')).toBe(6 + TESTING_ORGS.length);
    expect(entityTypeMap.get('Incident')).toBe(1);
    expect(entityTypeMap.get('Indicator')).toBe(3);
    expect(entityTypeMap.get('Intrusion-Set')).toBe(1);
    expect(entityTypeMap.get('Kill-Chain-Phase')).toBe(2);
    expect(entityTypeMap.get('Label')).toBe(13);
    expect(entityTypeMap.get('Region')).toBe(2);
    expect(entityTypeMap.get('Country')).toBe(1);
    expect(entityTypeMap.get('City')).toBe(1);
    expect(entityTypeMap.get('Administrative-Area')).toBe(1);
    expect(entityTypeMap.get('Malware')).toBe(2);
    expect(entityTypeMap.get('Malware-Analysis')).toBe(1);
    expect(entityTypeMap.get('ManagerConfiguration')).toBe(1);
    expect(entityTypeMap.get('Marking-Definition')).toBe(11);
    expect(entityTypeMap.get('Note')).toBe(1);
    expect(entityTypeMap.get('Notifier')).toBe(2);
    expect(entityTypeMap.get('Observed-Data')).toBe(1);
    expect(entityTypeMap.get('Opinion')).toBe(1);
    expect(entityTypeMap.get('Report')).toBe(1);
    expect(entityTypeMap.get('Role')).toBe(TESTING_ROLES.length + 3);
    expect(entityTypeMap.get('RuleManager')).toBe(1);
    expect(entityTypeMap.get('Settings')).toBe(1);
    expect(entityTypeMap.get('Software')).toBe(1);
    expect(entityTypeMap.get('Status')).toBe(7);
    expect(entityTypeMap.get('StatusTemplate')).toBe(8);
    expect(entityTypeMap.get('Threat-Actor-Individual')).toBe(2);
    expect(entityTypeMap.get('Threat-Actor-Group')).toBe(1);
    expect(entityTypeMap.get('Tracking-Number')).toBe(1);
    expect(entityTypeMap.get('User')).toBe(TESTING_USERS.length + 1);
    expect(entityTypeMap.get('Vocabulary')).toBe(VOCABULARY_COUNT);
    expect(data.edges.length).toEqual(535 + TESTING_ORGS.length + TESTING_USERS.length + TESTING_ROLES.length + TESTING_GROUPS.length);
    const filterBaseTypes = R.uniq(R.map((e) => e.node.base_type, data.edges));
    expect(filterBaseTypes.length).toEqual(1);
    expect(R.head(filterBaseTypes)).toEqual('ENTITY');
  });
  it('should entity search with trailing slash', async () => {
    const data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { search: '"groups/G0096"' });
    expect(data).not.toBeNull();
    // external-reference--d1b50d16-2c9c-45f2-8ae0-d5b554e0fbf5 | url
    // intrusion-set--18854f55-ac7c-4634-bd9a-352dd07613b7 | description
    expect(data.edges.length).toEqual(2);
  });
  it('should entity paginate everything after', async () => {
    const data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, {
      after: 'WyJ2b2NhYnVsYXJ5LS1mZGYyNTVhOC01ZjM3LTVmZWMtYWRmYS0xZGYwYjdkM2QwY2UiXQ==',
      first: ES_MAX_PAGINATION,
    });
    expect(data).not.toBeNull();
    expect(data.edges.length).toEqual(2);
  });
  it('should entity paginate domain objects sort by published', async () => {
    const data = await elPaginate(testContext, ADMIN_USER, READ_INDEX_STIX_DOMAIN_OBJECTS, {
      orderBy: 'published',
      first: 20,
      orderMode: 'desc',
    });
    expect(data).not.toBeNull();
    const entityTypeMap = mapEdgesCountPerEntityType(data);
    expect(entityTypeMap.get('Report')).toBe(1);
    expect(entityTypeMap.get('Attack-Pattern')).toBe(2);
    expect(entityTypeMap.get('Campaign')).toBe(1);
    expect(entityTypeMap.get('Course-Of-Action')).toBe(1);
    expect(entityTypeMap.get('Individual')).toBe(1);
    expect(entityTypeMap.get('Sector')).toBe(3);
    expect(entityTypeMap.get('Organization')).toBe(TESTING_ORGS.length + 6);
    expect(entityTypeMap.get('Incident')).toBe(1);
    expect(entityTypeMap.get('Indicator')).toBe(2);
    expect(data.edges.length).toEqual(20);
    expect(data.pageInfo.endCursor).toBeDefined();

    const { endCursor } = data.pageInfo;
    const nextPage = await elPaginate(testContext, ADMIN_USER, READ_INDEX_STIX_DOMAIN_OBJECTS, {
      orderBy: 'published',
      first: 20,
      orderMode: 'desc',
      after: endCursor,
    });
    expect(nextPage).not.toBeNull();
    expect(nextPage.edges.length).toBeGreaterThan(1);
  });
  it('should entity paginate with single type', async () => {
    // first = 200, after, types = null, filters = null, search = null,
    // orderBy = null, orderMode = 'asc',
    // connectionFormat = true
    const data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { types: ['Malware'] });
    expect(data).not.toBeNull();
    expect(data.edges.length).toEqual(2);
    const nodes = R.map((e) => e.node, data.edges);
    const malware = nodes.find((n) => (n.x_opencti_stix_ids ?? []).includes('malware--faa5b705-cf44-4e50-8472-29e5fec43c3c'));
    expect(malware).not.toBeUndefined();
    expect(malware.internal_id).not.toBeNull();
    expect(malware.name).toEqual('Paradise Ransomware');
    expect(malware._index).not.toBeNull();
    expect(malware.parent_types).toEqual(
      expect.arrayContaining(['Basic-Object', 'Stix-Object', 'Stix-Core-Object', 'Stix-Domain-Object'])
    );
  });
  it('should entity paginate everything for standard user', async () => {
    const WHITE_USER = await elWhiteUser();
    const data = await elPaginate(testContext, WHITE_USER, READ_ENTITIES_INDICES, { types: ['Malware'] });
    expect(data).not.toBeNull();
    expect(data.edges.length).toEqual(1);
  });
  it('should entity paginate with classic search', async () => {
    let data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { search: 'malicious' });
    expect(data.edges.length).toEqual(28);
    data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { search: 'with malicious' });
    expect(data.edges.length).toEqual(60);
    data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { search: '"with malicious"' });
    expect(data.edges.length).toEqual(2);
  });
  it('should entity paginate with escaped search', async () => {
    let data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { search: '(Citation:' });
    expect(data.edges.length).toEqual(4);
    data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { search: '[APT41]' });
    expect(data.edges.length).toEqual(2);
    data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { search: '%5BAPT41%5D' });
    expect(data.edges.length).toEqual(2);
  });
  it('should entity paginate with http and https', async () => {
    let data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { search: '"http://attack.mitre.org/groups/G0096"' });
    expect(data.edges.length).toEqual(2);
    data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { search: '"https://attack.mitre.org/groups/G0096"' });
    expect(data.edges.length).toEqual(2);
  });
  it('should entity paginate with incorrect encoding', async () => {
    const data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { search: '"ATT%"' });
    expect(data.edges.length).toEqual(2);
  });
  it('should entity paginate with field not exist filter', async () => {
    const filters = {
      mode: 'and',
      filters: [{ key: 'x_opencti_color', operator: 'nil', values: [] }],
      filterGroups: [],
    };
    const data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { filters, first: ES_MAX_PAGINATION });
    const entityTypeMap = mapEdgesCountPerEntityType(data);
    expect(entityTypeMap.get('Attack-Pattern')).toBe(2);
    expect(entityTypeMap.get('Campaign')).toBe(1);
    expect(entityTypeMap.get('Capability')).toBe(42);
    expect(entityTypeMap.get('Course-Of-Action')).toBe(1);
    expect(entityTypeMap.get('Credential')).toBe(1);
    expect(entityTypeMap.get('DecayRule')).toBe(4);
    expect(entityTypeMap.get('EntitySetting')).toBe(44);
    expect(entityTypeMap.get('External-Reference')).toBe(7);
    expect(entityTypeMap.get('StixFile')).toBe(1);
    expect(entityTypeMap.get('Group')).toBe(TESTING_GROUPS.length + 3);
    expect(entityTypeMap.get('Individual')).toBe(1);
    expect(entityTypeMap.get('Sector')).toBe(3);
    expect(entityTypeMap.get('Organization')).toBe(TESTING_ORGS.length + 6);
    expect(entityTypeMap.get('Incident')).toBe(1);
    expect(entityTypeMap.get('Indicator')).toBe(3);
    expect(entityTypeMap.get('Intrusion-Set')).toBe(1);
    expect(entityTypeMap.get('Kill-Chain-Phase')).toBe(2);
    expect(entityTypeMap.get('Label')).toBe(13);
    expect(entityTypeMap.get('Region')).toBe(2);
    expect(entityTypeMap.get('Country')).toBe(1);
    expect(entityTypeMap.get('City')).toBe(1);
    expect(entityTypeMap.get('Administrative-Area')).toBe(1);
    expect(entityTypeMap.get('Malware')).toBe(2);
    expect(entityTypeMap.get('Malware-Analysis')).toBe(1);
    expect(entityTypeMap.get('ManagerConfiguration')).toBe(1);
    expect(entityTypeMap.get('Note')).toBe(1);
    expect(entityTypeMap.get('Notifier')).toBe(2);
    expect(entityTypeMap.get('Observed-Data')).toBe(1);
    expect(entityTypeMap.get('Opinion')).toBe(1);
    expect(entityTypeMap.get('Report')).toBe(1);
    expect(entityTypeMap.get('Role')).toBe(9);
    expect(entityTypeMap.get('RuleManager')).toBe(1);
    expect(entityTypeMap.get('Settings')).toBe(1);
    expect(entityTypeMap.get('Software')).toBe(1);
    expect(entityTypeMap.get('Status')).toBe(7);
    expect(entityTypeMap.get('StatusTemplate')).toBe(8);
    expect(entityTypeMap.get('Threat-Actor-Individual')).toBe(2);
    expect(entityTypeMap.get('Threat-Actor-Group')).toBe(1);
    expect(entityTypeMap.get('Tracking-Number')).toBe(1);
    expect(entityTypeMap.get('User')).toBe(TESTING_USERS.length + 1);
    expect(entityTypeMap.get('Vocabulary')).toBe(VOCABULARY_COUNT);
    expect(data.edges.length).toEqual(544);
  });
  it('should entity paginate with field exist filter', async () => {
    const filters = {
      mode: 'and',
      filters: [{ key: 'x_opencti_color', operator: undefined, values: ['EXISTS'] }],
      filterGroups: [],
    };
    const data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { filters });
    expect(data.edges.length).toEqual(11);
  });
  it('should entity paginate with equality filter', async () => {
    // eq operation will use the field.keyword to do an exact field equality
    let filters = {
      mode: 'and',
      filters: [{ key: 'x_opencti_color', operator: 'eq', values: ['#c62828'] }],
      filterGroups: [],
    };
    let data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { filters });
    expect(data.edges.length).toEqual(2);
    // Special case when operator = eq + the field key is a dateFields => use a match
    filters = {
      mode: 'and',
      filters: [{ key: 'published', operator: 'eq', values: ['2020-03-01'] }],
      filterGroups: [],
    };
    data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { filters });
    expect(data.edges.length).toEqual(1);
  });
  it('should entity paginate with match filter', async () => {
    let filters = {
      mode: 'and',
      filters: [{ key: 'entity_type', operator: 'match', values: ['marking'] }],
      filterGroups: [],
    };
    let data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { filters });
    expect(data.edges.length).toEqual(11); // The 4 Default TLP + MITRE Corporation
    // Verify that nothing is found in this case if using the eq operator
    filters = {
      mode: 'and',
      filters: [{ key: 'entity_type', operator: 'eq', values: ['marking'] }],
      filterGroups: [],
    };
    data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { filters });
    expect(data.edges.length).toEqual(0);
  });
  it('should entity paginate with dates filter', async () => {
    let filters = {
      mode: 'and',
      filters: [{ key: 'created', operator: 'lte', values: ['2017-06-01T00:00:00.000Z'] }],
      filterGroups: [],
    };
    let data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { filters });
    expect(data.edges.length).toEqual(2); // The 4 Default TLP + MITRE Corporation
    filters = {
      mode: 'and',
      filters: [
        { key: 'created', operator: 'gt', values: ['2020-03-01T14:06:06.255Z'] },
        { key: 'color', operator: 'nil', values: [] },
      ],
      filterGroups: [],
    };
    data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { filters, first: ES_MAX_PAGINATION });
    const entityTypeMap = mapEdgesCountPerEntityType(data);
    expect(entityTypeMap.get('External-Reference')).toBe(7);
    expect(entityTypeMap.get('Individual')).toBe(1);
    expect(entityTypeMap.get('Organization')).toBe(TESTING_ORGS.length);
    expect(entityTypeMap.get('Incident')).toBe(1);
    expect(entityTypeMap.get('Kill-Chain-Phase')).toBe(2);
    expect(entityTypeMap.get('Malware-Analysis')).toBe(1);
    expect(entityTypeMap.get('Marking-Definition')).toBe(9);
    expect(entityTypeMap.get('Note')).toBe(1);
    expect(entityTypeMap.get('Notifier')).toBe(2);
    expect(entityTypeMap.get('Opinion')).toBe(1);
    expect(entityTypeMap.get('Threat-Actor-Individual')).toBe(1);
    expect(entityTypeMap.get('Vocabulary')).toBe(VOCABULARY_COUNT);
    expect(data.edges.length).toEqual(VOCABULARY_COUNT + TESTING_ORGS.length + 26);
    filters = {
      mode: 'and',
      filters: [
        { key: 'created', operator: 'lte', values: ['2017-06-01T00:00:00.000Z'] },
        { key: 'created', operator: 'gt', values: ['2020-03-01T14:06:06.255Z'] },
      ],
      filterGroups: [],
    };
    data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, { filters });
    expect(data.edges.length).toEqual(0);
  });
  it('should entity paginate with date ordering', async () => {
    const data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, {
      orderBy: 'created',
      orderMode: 'asc',
      first: ES_MAX_PAGINATION
    });
    const entityTypeMap = mapEdgesCountPerEntityType(data);
    expect(entityTypeMap.get('Capability')).toBe(42);
    expect(entityTypeMap.get('Credential')).toBe(1);
    expect(entityTypeMap.get('DecayRule')).toBe(4);
    expect(entityTypeMap.get('EntitySetting')).toBe(44);
    expect(entityTypeMap.get('StixFile')).toBe(1);
    expect(entityTypeMap.get('Group')).toBe(TESTING_GROUPS.length + 3);
    expect(entityTypeMap.get('ManagerConfiguration')).toBe(1);
    expect(entityTypeMap.get('Role')).toBe(TESTING_ROLES.length + 3);
    expect(entityTypeMap.get('RuleManager')).toBe(1);
    expect(entityTypeMap.get('Settings')).toBe(1);
    expect(entityTypeMap.get('Software')).toBe(1);
    expect(entityTypeMap.get('Status')).toBe(7);
    expect(entityTypeMap.get('StatusTemplate')).toBe(8);
    expect(entityTypeMap.get('Tracking-Number')).toBe(1);
    expect(entityTypeMap.get('User')).toBe(TESTING_USERS.length + 1);
    expect(entityTypeMap.get('Organization')).toBe(TESTING_ORGS.length + 6);
    expect(entityTypeMap.get('Marking-Definition')).toBe(11);
    expect(entityTypeMap.get('Attack-Pattern')).toBe(2);
    expect(entityTypeMap.get('Threat-Actor-Individual')).toBe(2);
    expect(entityTypeMap.get('Threat-Actor-Group')).toBe(1);
    expect(entityTypeMap.get('Course-Of-Action')).toBe(1);
    expect(entityTypeMap.get('Intrusion-Set')).toBe(1);
    expect(entityTypeMap.get('Malware')).toBe(2);
    expect(entityTypeMap.get('Region')).toBe(2);
    expect(entityTypeMap.get('Country')).toBe(1);
    expect(entityTypeMap.get('Administrative-Area')).toBe(1);
    expect(entityTypeMap.get('Sector')).toBe(3);
    expect(entityTypeMap.get('Observed-Data')).toBe(1);
    expect(entityTypeMap.get('Indicator')).toBe(3);
    expect(entityTypeMap.get('Campaign')).toBe(1);
    expect(entityTypeMap.get('City')).toBe(1);
    expect(entityTypeMap.get('Report')).toBe(1);
    expect(entityTypeMap.get('Note')).toBe(1);
    expect(entityTypeMap.get('Opinion')).toBe(1);
    expect(entityTypeMap.get('Incident')).toBe(1);
    expect(entityTypeMap.get('Individual')).toBe(1);
    expect(entityTypeMap.get('Malware-Analysis')).toBe(1);
    expect(entityTypeMap.get('Vocabulary')).toBe(VOCABULARY_COUNT);
    expect(entityTypeMap.get('Notifier')).toBe(2);
    expect(entityTypeMap.get('Label')).toBe(13);
    expect(entityTypeMap.get('Kill-Chain-Phase')).toBe(2);
    expect(entityTypeMap.get('External-Reference')).toBe(7);
    expect(data.edges.length).toEqual(555);
    const createdDates = R.map((e) => e.node.created, data.edges);
    let previousCreatedDate = null;
    for (let index = 0; index < createdDates.length; index += 1) {
      const createdDate = createdDates[index];
      if (!previousCreatedDate) {
        previousCreatedDate = createdDate;
      } else {
        const previousMoment = utcDate(previousCreatedDate);
        const currentMoment = utcDate(createdDate);
        expect(previousMoment.isValid()).toBeTruthy();
        expect(currentMoment.isValid()).toBeTruthy();
        expect(previousMoment.isSameOrBefore(currentMoment)).toBeTruthy();
      }
    }
  });
  it('should entity paginate with keyword ordering', async () => {
    const filters = {
      mode: 'and',
      filters: [{ key: 'x_opencti_color', operator: undefined, values: ['EXISTS'] }],
      filterGroups: [],
    };
    const data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, {
      filters,
      orderBy: 'definition',
      orderMode: 'desc',
    });
    expect(data.edges.length).toEqual(11);
    const markings = R.map((e) => e.node.definition, data.edges);
    expect(markings[0]).toEqual('TLP:TEST');
    expect(markings[1]).toEqual('TLP:RED');
    expect(markings[2]).toEqual('TLP:GREEN');
    expect(markings[3]).toEqual('TLP:CLEAR');
    expect(markings[4]).toEqual('TLP:AMBER+STRICT');
    expect(markings[5]).toEqual('TLP:AMBER');
    expect(markings[6]).toEqual('PAP:RED');
    expect(markings[7]).toEqual('PAP:GREEN');
    expect(markings[8]).toEqual('PAP:CLEAR');
    expect(markings[9]).toEqual('PAP:AMBER');
  });
  it('should entity paginate with object ordering (desc)', async () => {
    const filters = {
      mode: 'and',
      filters: [{ key: 'entity_type', operator: 'eq', values: ['Group'] }],
      filterGroups: [],
    };
    const data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, {
      filters,
      orderBy: 'group_confidence_level',
      orderMode: 'desc',
    });
    expect(data.edges.length).toEqual(TESTING_GROUPS.length + 3); // there are 3 built-in groups in initialization

    let previousConfidenceLevel = 100;
    for (let i = 0; i < data.edges.length; i += 1) {
      const groupData = data.edges[i].node;
      const currentGroupInTestGroups = TESTING_GROUPS.find((testGroup) => testGroup.name === groupData.name);
      if (currentGroupInTestGroups) {
        expect(groupData.group_confidence_level.max_confidence).toBe(currentGroupInTestGroups.group_confidence_level.max_confidence);
      } else {
        // Built groups in have 100
        expect(groupData.group_confidence_level.max_confidence).toBe(100);
      }
      expect(groupData.group_confidence_level.max_confidence).lessThanOrEqual(previousConfidenceLevel);
      previousConfidenceLevel = groupData.group_confidence_level.max_confidence;
    }
  });
  it('should entity paginate with object ordering (asc)', async () => {
    const filters = {
      mode: 'and',
      filters: [{ key: 'entity_type', operator: 'eq', values: ['Group'] }],
      filterGroups: [],
    };
    const data = await elPaginate(testContext, ADMIN_USER, READ_ENTITIES_INDICES, {
      filters,
      orderBy: 'group_confidence_level',
      orderMode: 'asc',
    });
    expect(data.edges.length).toEqual(TESTING_GROUPS.length + 3); // there are 3 built-in groups in initialization

    let previousConfidenceLevel = 0;
    for (let i = 0; i < data.edges.length; i += 1) {
      const groupData = data.edges[i].node;
      const currentGroupInTestGroups = TESTING_GROUPS.find((testGroup) => testGroup.name === groupData.name);
      if (currentGroupInTestGroups) {
        expect(groupData.group_confidence_level.max_confidence).toBe(currentGroupInTestGroups.group_confidence_level.max_confidence);
      } else {
        // Built groups in have 100
        expect(groupData.group_confidence_level.max_confidence).toBe(100);
      }
      expect(groupData.group_confidence_level.max_confidence).greaterThanOrEqual(previousConfidenceLevel);
      previousConfidenceLevel = groupData.group_confidence_level.max_confidence;
    }
  });
  it('should relation paginate everything', async () => {
    let data = await elPaginate(testContext, ADMIN_USER, READ_RELATIONSHIPS_INDICES, { includeAuthorities: true });
    expect(data).not.toBeNull();
    const groupByIndices = R.groupBy((e) => e.node._index, data.edges);
    const internalRelationships = groupByIndices[`${ES_INDEX_PREFIX}_internal_relationships-000001`].map((m) => m.node);
    const internalRelationshipsByType = R.groupBy((m) => m.entity_type, internalRelationships);
    expect(internalRelationshipsByType['accesses-to'].length).toEqual(28);
    expect(internalRelationshipsByType['has-capability'].length).toEqual(56);
    expect(internalRelationshipsByType['has-role'].length).toEqual(9);
    expect(internalRelationshipsByType['member-of'].length).toEqual(13);
    expect(internalRelationshipsByType['participate-to'].length).toEqual(4);

    const stixCoreRelationships = groupByIndices[`${ES_INDEX_PREFIX}_stix_core_relationships-000001`].map((m) => m.node);
    const stixCoreRelationshipsByType = R.groupBy((m) => m.entity_type, stixCoreRelationships);
    expect(stixCoreRelationshipsByType['attributed-to'].length).toEqual(2);
    expect(stixCoreRelationshipsByType.indicates.length).toEqual(4);
    expect(stixCoreRelationshipsByType['located-at'].length).toEqual(4);
    expect(stixCoreRelationshipsByType.mitigates.length).toEqual(1);
    expect(stixCoreRelationshipsByType['part-of'].length).toEqual(6);
    expect(stixCoreRelationshipsByType['related-to'].length).toEqual(2);
    expect(stixCoreRelationshipsByType.targets.length).toEqual(2);
    expect(stixCoreRelationshipsByType.uses.length).toEqual(3);
    expect(groupByIndices[`${ES_INDEX_PREFIX}_stix_core_relationships-000001`].length).toEqual(24);

    const stixMetaRelationships = groupByIndices[`${ES_INDEX_PREFIX}_stix_meta_relationships-000001`].map((m) => m.node);
    const stixMetaRelationshipsByType = R.groupBy((m) => m.entity_type, stixMetaRelationships);
    expect(stixMetaRelationshipsByType['created-by'].length).toEqual(22);
    expect(stixMetaRelationshipsByType['external-reference'].length).toEqual(7);
    expect(stixMetaRelationshipsByType['kill-chain-phase'].length).toEqual(3);
    expect(stixMetaRelationshipsByType['object-label'].length).toEqual(30);
    expect(stixMetaRelationshipsByType['object-marking'].length).toEqual(28);
    expect(stixMetaRelationshipsByType['operating-system'].length).toEqual(1);
    expect(stixMetaRelationshipsByType.object.length).toEqual(38);
    expect(groupByIndices[`${ES_INDEX_PREFIX}_stix_meta_relationships-000001`].length).toEqual(129);

    expect(groupByIndices[`${ES_INDEX_PREFIX}_stix_sighting_relationships-000001`].length).toEqual(2);

    const metas = groupByIndices[`${ES_INDEX_PREFIX}_stix_meta_relationships-000001`].map((m) => m.node);
    const metaByEntityType = R.groupBy((m) => m.entity_type, metas);
    expect(metaByEntityType.object.length).toEqual(38);
    expect(metaByEntityType['object-label'].length).toEqual(30);
    expect(metaByEntityType['created-by'].length).toEqual(22);
    expect(metaByEntityType['external-reference'].length).toEqual(7);
    expect(metaByEntityType['object-marking'].length).toEqual(28);
    expect(metaByEntityType['kill-chain-phase'].length).toEqual(3);
    expect(metaByEntityType['operating-system'].length).toEqual(1);
    expect(data.edges.length).toEqual(265);
    let filterBaseTypes = R.uniq(R.map((e) => e.node.base_type, data.edges));
    expect(filterBaseTypes.length).toEqual(1);
    expect(R.head(filterBaseTypes)).toEqual('RELATION');
    // Same query with no pagination
    data = await elPaginate(testContext, ADMIN_USER, READ_RELATIONSHIPS_INDICES, { connectionFormat: false });
    expect(data).not.toBeNull();
    const entityTypeMap = mapCountPerEntityType(data);
    expect(entityTypeMap.get('has-capability')).toBe(56);
    expect(entityTypeMap.get('accesses-to')).toBe(28);
    expect(entityTypeMap.get('member-of')).toBe(13);
    expect(entityTypeMap.get('has-role')).toBe(9);
    expect(entityTypeMap.get('participate-to')).toBe(4);
    expect(entityTypeMap.get('uses')).toBe(3);
    expect(entityTypeMap.get('part-of')).toBe(6);
    expect(entityTypeMap.get('indicates')).toBe(4);
    expect(entityTypeMap.get('located-at')).toBe(4);
    expect(entityTypeMap.get('targets')).toBe(2);
    expect(entityTypeMap.get('mitigates')).toBe(1);
    expect(entityTypeMap.get('related-to')).toBe(2);
    expect(entityTypeMap.get('attributed-to')).toBe(2);
    expect(entityTypeMap.get('created-by')).toBe(22);
    expect(entityTypeMap.get('object')).toBe(38);
    expect(entityTypeMap.get('object-marking')).toBe(28);
    expect(entityTypeMap.get('object-label')).toBe(30);
    expect(entityTypeMap.get('kill-chain-phase')).toBe(3);
    expect(entityTypeMap.get('external-reference')).toBe(7);
    expect(entityTypeMap.get('operating-system')).toBe(1);
    expect(entityTypeMap.get('stix-sighting-relationship')).toBe(2);
    expect(data.length).toEqual(265);
    filterBaseTypes = R.uniq(R.map((e) => e.base_type, data));
    expect(filterBaseTypes.length).toEqual(1);
    expect(R.head(filterBaseTypes)).toEqual('RELATION');
  });
  it('should not break on null', async () => {
    const data = await elPaginate(testContext, ADMIN_USER, READ_INDEX_INTERNAL_OBJECTS, {
      filters: {
        mode: 'and',
        filters: [{
          key: [buildRefRelationKey(RELATION_OBJECT_LABEL)],
          operator: 'nil',
          values: [],
        }],
        filterGroups: [],
      }
    });
    expect(data).not.toBeNull();
  });
  it('should break on multi values with nested', async () => {
    const data = elPaginate(testContext, ADMIN_USER, READ_INDEX_INTERNAL_OBJECTS, {
      filters: {
        mode: 'and',
        filters: [{
          key: ['name', 'created_at'],
          value: null,
          nested: [{
            key: 'name',
            values: ['test'],
          }],
        }],
        filterGroups: [],
      },
    });
    await expect(data).rejects.toThrow('Filter must have only one field');
  });
});

describe('Elasticsearch basic loader', () => {
  it('should entity load by internal id', async () => {
    const malware = await elLoadById(testContext, ADMIN_USER, 'malware--faa5b705-cf44-4e50-8472-29e5fec43c3c', { type: 'Stix-Domain-Object' });
    const data = await elLoadById(testContext, ADMIN_USER, malware.internal_id);
    expect(data).not.toBeNull();
    expect(data.standard_id).toEqual('malware--21c45dbe-54ec-5bb7-b8cd-9f27cc518714');
    expect(data.revoked).toBeFalsy();
    expect(data.name).toEqual('Paradise Ransomware');
    expect(data.entity_type).toEqual('Malware');
  });
  it('should entity load by stix id', async () => {
    const data = await elLoadById(testContext, ADMIN_USER, 'malware--faa5b705-cf44-4e50-8472-29e5fec43c3c', { type: 'Stix-Domain-Object' });
    expect(data).not.toBeNull();
    expect(data.revoked).toBeFalsy();
    expect(data.name).toEqual('Paradise Ransomware');
    expect(data.entity_type).toEqual('Malware');
  });
  it('should relation reconstruct', async () => {
    const data = await elLoadById(testContext, ADMIN_USER, 'relationship--8d2200a8-f9ef-4345-95d1-ba3ed49606f9');
    expect(data).not.toBeNull();
    expect(data.fromRole).toEqual('indicates_from');
    expect(data.toRole).toEqual('indicates_to');
    expect(data.entity_type).toEqual('indicates');
  });
});

describe('Elasticsearch reindex', () => {
  it('should relation correctly indexed', async () => {
    const malware = await elLoadById(testContext, ADMIN_USER, 'malware--faa5b705-cf44-4e50-8472-29e5fec43c3c');
    const malwareInternalId = malware.internal_id;
    const attackPattern = await elLoadById(testContext, ADMIN_USER, 'attack-pattern--2fc04aa5-48c1-49ec-919a-b88241ef1d17');
    const attackPatternId = attackPattern.internal_id;
    // relationship_type -> uses
    // source_ref -> malware--faa5b705-cf44-4e50-8472-29e5fec43c3c
    // target_ref -> attack-pattern--2fc04aa5-48c1-49ec-919a-b88241ef1d17
    const data = await elLoadById(testContext, ADMIN_USER, 'relationship--1fc9b5f8-3822-44c5-85d9-ee3476ca26de');
    expect(data).not.toBeNull();
    expect(data.fromId === malwareInternalId).toBeTruthy(); // malware--faa5b705-cf44-4e50-8472-29e5fec43c3c
    expect(data.toId === attackPatternId).toBeTruthy(); // attack-pattern--2fc04aa5-48c1-49ec-919a-b88241ef1d17
  });
  it('should relation reindex check consistency', async () => {
    const indexPromise = elIndexElements(testContext, ADMIN_USER, 'uses', [{ relationship_type: 'uses' }]);
    // noinspection ES6MissingAwait
    expect(indexPromise).rejects.toThrow();
  });
  it('should reindex sighting with unmapped fields', async () => {
    // dummy object with old fields that are not part of the strict mapping
    const jsonObject = `{
      "standard_id": "sighting--9f9dd79c-bdff-4c0f-be14-ff11d773d445",
      "rel_has-reference.internal_id": [
        "5524eb65-1a55-43b2-ac22-81efe3faf21a"
      ],
      "attribute_count": 1,
      "first_seen": "2023-08-20T22:00:00.000Z",
      "last_seen": "2023-08-20T22:00:00.000Z",
      "parent_types": [
        "basic-relationship",
        "stix-relationship"
      ],
      "created_at": "2023-08-21T09:04:31.986Z",
      "description": "",
      "revoked": false,
      "base_type": "RELATION",
      "relationship_type": "stix-sighting-relationship",
      "updated_at": "2023-08-21T09:04:31.986Z",
      "fromType": "Indicator",
      "x_opencti_negative": false,
      "modified": "2023-08-21T09:04:31.986Z",
      "id": "de618300-4673-4719-9b53-bdf29ad1b440",
      "lang": "en",
      "toType": "Sector",
      "internal_id": "de618300-4673-4719-9b53-bdf29ad1b440",
      "created": "2023-08-21T09:04:31.986Z",
      "confidence": 75,
      "entity_type": "stix-sighting-relationship",
      "creator_id": [
        "57881196-4a57-4e61-b373-a971f2f3ce1f"
      ],
      "i_stop_time_year": "2023",
      "i_created_at_day": "2023-05-04",
      "i_start_time_year": "2023",
      "i_start_time_month": "2023-05",
      "i_created_at_month": "2023-05",
      "i_created_at_year": "2023",
      "i_stop_time_month": "2023-05",
      "i_start_time_day": "2023-05-04",
      "i_stop_time_day": "2023-05-04",
      "x_opencti_stix_ids": []
    }`;
    const documentBody = JSON.parse(jsonObject);
    await elIndex('test_reindex', documentBody);
    await elReindexElements(testContext, ADMIN_USER, ['de618300-4673-4719-9b53-bdf29ad1b440'], 'test_reindex', 'test_deleted_objects');
  });
  it('should reindex indicator with unmapped fields', async () => {
    // object with old fields from issue/9270
    const jsonObject = `{
      "pattern_type": "stix",
      "pattern": "[file:name = 'redacted']",
      "x_opencti_main_observable_type": "StixFile",
      "name": "redacted",
      "description": "Simple indicator of observable {redacted}",
      "x_opencti_score": 80,
      "x_opencti_detection": false,
      "valid_from": "2023-02-28T02:21:45.436Z",
      "valid_until": "2024-02-28T02:21:45.436Z",
      "entity_type": "Indicator",
      "internal_id": "785e743c-b978-416a-aaba-2193f199604f",
      "standard_id": "indicator--d6a11acd-bd10-50fa-afda-0ea341e5b92f",
      "creator_id": "7f817b19-2bc8-482f-8662-c0db011accea",
      "x_opencti_stix_ids": [],
      "spec_version": "2.1",
      "created_at": "2023-02-27T20:02:13.552Z",
      "updated_at": "2024-02-28T02:23:46.892Z",
      "revoked": true,
      "confidence": 15,
      "lang": "en",
      "created": "2023-02-27T20:02:13.552Z",
      "modified": "2024-02-28T02:23:46.892Z",
      "i_valid_from_day": "2023-02-28",
      "i_valid_from_month": "2023-02",
      "i_valid_from_year": "2023",
      "i_valid_until_day": "2024-02-28",
      "i_valid_until_month": "2024-02",
      "i_valid_until_year": "2024",
      "i_created_at_day": "2023-02-27",
      "i_created_at_month": "2023-02",
      "i_created_at_year": "2023",
      "id": "785e743c-b978-416a-aaba-2193f199604f",
      "base_type": "ENTITY",
      "parent_types": [
        "Basic-Object",
        "Stix-Object",
        "Stix-Core-Object",
        "Stix-Domain-Object"
      ],
      "rel_created-by.internal_id": [
        "1e43f46b-449e-4d08-83e8-02bec6d5a1dc"
      ],
      "rel_object-marking.internal_id": [
        "6df6a7e1-5b05-46e7-a912-38ac685d3a24"
      ],
      "rel_object-label.internal_id": [
        "c6054a03-e9cc-45a6-91b8-31b9652e20a2"
      ],
      "rel_based-on.internal_id": [
        "bb90da0d-ecfa-4f49-a9e9-90266d30629d"
      ]
    }`;
    const documentBody = JSON.parse(jsonObject);
    await elIndex('test_reindex', documentBody);
    await elReindexElements(testContext, ADMIN_USER, ['785e743c-b978-416a-aaba-2193f199604f'], 'test_reindex', 'test_deleted_objects');
  });
});
