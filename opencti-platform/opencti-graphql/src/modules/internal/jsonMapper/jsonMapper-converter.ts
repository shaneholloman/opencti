/*
Copyright (c) 2021-2025 Filigran SAS

This file is part of the OpenCTI Enterprise Edition ("EE") and is
licensed under the OpenCTI Enterprise Edition License (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

https://github.com/OpenCTI-Platform/opencti/blob/master/LICENSE

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

import { buildStixObject } from '../../../database/stix-2-1-converter';
import type { StixJsonMapper, StoreEntityJsonMapper } from './jsonMapper-types';
import { STIX_EXT_OCTI } from '../../../types/stix-2-1-extensions';
import { cleanObject } from '../../../database/stix-converter-utils';

const convertJsonMapperToStix = (instance: StoreEntityJsonMapper): StixJsonMapper => {
  const stixObject = buildStixObject(instance);
  return {
    ...stixObject,
    name: instance.name,
    representations: instance.representations,
    extensions: {
      [STIX_EXT_OCTI]: cleanObject({
        ...stixObject.extensions[STIX_EXT_OCTI],
        extension_type: 'new-sdo',
      })
    }
  };
};

export default convertJsonMapperToStix;
