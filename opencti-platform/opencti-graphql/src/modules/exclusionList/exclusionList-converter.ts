import type { StixExclusionList, StoreEntityExclusionList } from './exclusionList-types';
import { buildStixObject } from '../../database/stix-2-1-converter';
import { STIX_EXT_OCTI } from '../../types/stix-2-1-extensions';
import { cleanObject } from '../../database/stix-converter-utils';

const convertExclusionListToStix = (instance: StoreEntityExclusionList): StixExclusionList => {
  const stixObject = buildStixObject(instance);
  return {
    ...stixObject,
    name: instance.name,
    description: instance.description,
    exclusion_list_entity_types: instance.exclusion_list_entity_types,
    file_id: instance.file_id,
    enabled: instance.enabled,
    extensions: {
      [STIX_EXT_OCTI]: cleanObject({
        ...stixObject.extensions[STIX_EXT_OCTI],
        extension_type: 'new-sdo',
      })
    }
  };
};

export default convertExclusionListToStix;
