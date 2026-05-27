/**
 * Normalize admission request body from JSON, form-data string fields, or flat payloads.
 */
const normalizeAdmissionBody = (body) => {
  let data = body;

  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return {};
    }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {};
  }

  let applicant = data.applicant;

  if (typeof applicant === 'string') {
    try {
      applicant = JSON.parse(applicant);
    } catch {
      applicant = null;
    }
  }

  if (Array.isArray(applicant)) {
    applicant = applicant[0];
  }

  // Flat body: { fullName, relationshipToRequester, ... } without applicant wrapper
  if (!applicant && data.fullName) {
    const {
      residentId,
      preferredAdmissionDate,
      reasonForAdmission,
      notes,
      requestedByPhone,
      relationshipToRequester,
      ...applicantFields
    } = data;
    applicant = {
      ...applicantFields,
      relationshipToRequester:
        applicantFields.relationshipToRequester || relationshipToRequester,
    };
    return {
      residentId,
      preferredAdmissionDate,
      reasonForAdmission,
      notes,
      requestedByPhone,
      relationshipToRequester,
      applicant,
    };
  }

  if (applicant && typeof applicant === 'object' && !Array.isArray(applicant)) {
    if (!applicant.fullName && applicant.full_name) {
      applicant.fullName = applicant.full_name;
    }
    if (!applicant.relationshipToRequester && applicant.relationship_to_requester) {
      applicant.relationshipToRequester = applicant.relationship_to_requester;
    }
  }

  return { ...data, applicant };
};

module.exports = { normalizeAdmissionBody };
